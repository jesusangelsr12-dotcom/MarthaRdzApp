/**
 * GET/POST/PATCH/DELETE /api/citas
 * Lee citas de un día, registra, edita la nota o elimina (soft-delete) una cita.
 * GET    ?fecha=2026-02-24        → { citas: [...] } (cada una con anticipo, anticipo_de_agenda, anticipo_aplicado)
 * GET    ?anticipos=pendientes    → { anticipos: [{ id, clienta, fecha, monto }] }
 * POST   { fecha, timestamp, clienta, items, total, metodo_pago, nota?, comisiones?,
 *          anticipo?, anticipo_origen_id? } → { success }
 * PATCH  { fecha, timestamp, clienta, nota } → { success }
 * PATCH  { fecha, timestamp, clienta, items, anticipo? } → { success, total }
 *        corrige precios (ver "Corregir precios" abajo)
 * DELETE { fecha, timestamp, clienta } → { success }
 *
 * Todas las llamadas requieren `Authorization: Bearer <token>` (emitido por
 * /api/login). El salón de cada consulta es SIEMPRE el del token verificado
 * — nunca un sheet_id que mande el cliente — así una sesión de un salón no
 * puede leer ni tocar los datos de otro.
 *
 * items es un JSON array: [{"tipo":"servicio","nombre":"Corte","costo":200}, ...]
 *
 * anticipo: la parte del total que la clienta ya había pagado antes. Va
 * DENTRO del total (cita de 2500 con 500 de anticipo → total 2500, anticipo
 * 500): los 2500 cuentan como ingreso el día de la cita y las comisiones
 * salen sobre el precio completo. Nunca puede ser mayor que el total.
 *
 * anticipos=pendientes / anticipo_origen_id: la Agenda (ya retirada) guardaba
 * cada anticipo como una fila propia de `citas` (un solo item tipo
 * 'anticipo') el día que se pagaba. Las que siguen vivas son anticipos
 * pendientes de aplicar. Al registrar la cita de esa clienta con
 * `anticipo_origen_id`, esa fila se oculta (deleted_at) en la MISMA sentencia
 * que inserta la cita — así el dinero se mueve al día de la cita sin
 * contarse dos veces, y no se puede aplicar el mismo anticipo dos veces
 * (candado: solo se oculta si sigue viva). El monto debe coincidir con el
 * de esa fila. Si después se elimina la cita, la fila del anticipo vuelve a
 * quedar pendiente; el "Deshacer" la vuelve a ocultar.
 *
 * Corregir precios (PATCH con `items`): para un error de captura. Solo
 * cambian los `costo` — mismos items, en el mismo orden, con el mismo tipo y
 * nombre — y, si se manda, el `anticipo`. El servidor recalcula `total`
 * (nunca lo toma del cliente) y las comisiones de esa cita con su mismo %,
 * todo en una sola sentencia. Reglas:
 * - Una fila de solo-anticipo de la Agenda vieja no se corrige aquí.
 * - Si el anticipo vino de la Agenda (`anticipo_origen_id`), su monto no
 *   cambia: está atado a esa fila.
 * - En citas cobradas desde la Agenda (`anticipo_aplicado` > 0) el total se
 *   sigue guardando neto de ese anticipo, y no se les agrega `anticipo`.
 * - El anticipo nunca puede quedar mayor que el total.
 *
 * PATCH/DELETE identifican la cita por (fecha, timestamp, clienta) porque
 * el frontend nunca recibe un id de fila — igual que con Sheets.
 *
 * DELETE no borra la fila: marca `deleted_at` para poder recuperarla si
 * alguien la eliminó por error. También marca `deleted_at` en las comisiones
 * de esa cita (identificadas igual, por salón+fecha+timestamp+clienta) para
 * que no sigan contando en Comisiones/Dashboard; el restore (PATCH) las
 * recupera junto con la cita.
 *
 * Una trabajadora solo puede usar POST (registrar/cobrar una cita) y la
 * lista de anticipos pendientes (la necesita para registrar bien la cita);
 * si manda comisiones, únicamente puede asignárselas a sí misma. Ver
 * Registros (GET ?fecha) y editar/eliminar (PATCH/DELETE) son solo de la dueña.
 */

const { getSql } = require('../lib/db');
const { requireSession, getSessionRole } = require('../lib/auth');
const { isDateStr, isFiniteNumber, isNonEmptyString, isMetodoPago, isUuid } = require('../lib/validate');
const { enviarPushSalon } = require('../lib/push');

// Filas de `citas` que son solo el depósito de un anticipo de la Agenda vieja.
const SOLO_ANTICIPO = '[{"tipo":"anticipo"}]';

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((it) =>
    it && (it.tipo === 'servicio' || it.tipo === 'producto') &&
    isNonEmptyString(it.nombre, 200) &&
    isFiniteNumber(it.costo, { min: 0, max: 1_000_000 })
  );
}

function validarComisiones(comisiones) {
  if (comisiones === undefined || comisiones === null) return true;
  if (!Array.isArray(comisiones)) return false;
  return comisiones.every((c) =>
    c && isNonEmptyString(c.trabajadora, 200) &&
    isNonEmptyString(c.item, 200) &&
    (c.tipo === 'servicio' || c.tipo === 'producto') &&
    isFiniteNumber(c.costo, { min: 0, max: 1_000_000 }) &&
    isFiniteNumber(c.pct, { min: 0, max: 100 }) &&
    isFiniteNumber(c.comision, { min: 0, max: 1_000_000 })
  );
}

/** Redondeo a centavos, igual que la comisión que calcula Registrar Cita. */
function centavos(n) {
  return Math.round(n * 100) / 100;
}

/** PATCH con `items`: corrige los precios (y el anticipo) de una cita ya
 * registrada y recalcula su total y sus comisiones. Ver el encabezado. */
async function corregirPrecios(sql, res, salonId, { fecha, timestamp, clienta, items, anticipo }) {
  if (!validarItems(items)) {
    return res.status(400).json({ error: 'Precios inválidos' });
  }
  if (anticipo !== undefined && !isFiniteNumber(anticipo, { min: 0, max: 10_000_000 })) {
    return res.status(400).json({ error: 'Anticipo inválido' });
  }

  const filas = await sql`
    select id, items, anticipo, anticipo_origen_id, anticipo_aplicado
    from citas
    where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
      and deleted_at is null
  `;
  if (filas.length === 0) {
    return res.status(404).json({ error: 'Cita no encontrada' });
  }
  if (filas.length > 1) {
    // Dos citas idénticas al segundo: no hay forma segura de saber cuál es.
    return res.status(409).json({ error: 'Hay dos citas iguales a esa hora; no se puede saber cuál corregir' });
  }

  const actual = filas[0];
  const itemsActuales = actual.items || [];
  if (itemsActuales.some((it) => it.tipo === 'anticipo')) {
    return res.status(400).json({ error: 'Este registro es un anticipo de la Agenda; no se corrige aquí' });
  }
  const mismosItems = itemsActuales.length === items.length &&
    items.every((it, i) => it.tipo === itemsActuales[i].tipo && it.nombre === itemsActuales[i].nombre);
  if (!mismosItems) {
    return res.status(400).json({ error: 'Solo se pueden cambiar los precios, no los servicios ni productos' });
  }

  const anticipoActual = Number(actual.anticipo) || 0;
  const anticipoAplicado = Number(actual.anticipo_aplicado) || 0;
  const nuevoAnticipo = anticipo === undefined ? anticipoActual : Number(anticipo);
  if (actual.anticipo_origen_id && nuevoAnticipo !== anticipoActual) {
    return res.status(400).json({ error: 'Este anticipo viene de la Agenda; su monto no se puede cambiar' });
  }
  if (anticipoAplicado > 0 && nuevoAnticipo > 0) {
    return res.status(400).json({ error: 'Esta cita se cobró desde la Agenda; su anticipo ya está descontado' });
  }

  const suma = centavos(items.reduce((acc, it) => acc + Number(it.costo), 0));
  const total = centavos(suma - anticipoAplicado);
  if (total < 0) {
    return res.status(400).json({ error: `El total no puede quedar menor que el anticipo aplicado (${anticipoAplicado})` });
  }
  if (nuevoAnticipo > total) {
    return res.status(400).json({ error: 'El anticipo no puede ser mayor que el total' });
  }

  const nuevosItems = items.map((it) => ({ tipo: it.tipo, nombre: it.nombre, costo: Number(it.costo) }));
  const itemsJson = JSON.stringify(nuevosItems);

  // Cita y comisiones en una sola sentencia: o cambian las dos o ninguna.
  // Cada comisión toma el nuevo precio de su item (por tipo + nombre) y
  // conserva su %.
  const [r] = await sql`
    with cita as (
      update citas set items = ${itemsJson}::jsonb, total = ${total}, anticipo = ${nuevoAnticipo}
      where id = ${actual.id} and deleted_at is null
      returning id
    ),
    precios as (
      select distinct on (x.tipo, x.nombre) x.tipo, x.nombre, x.costo
      from jsonb_to_recordset(${itemsJson}::jsonb) as x(tipo text, nombre text, costo numeric)
      order by x.tipo, x.nombre
    ),
    coms as (
      update comisiones c
      set costo = p.costo, comision = round(p.costo * c.pct / 100, 2)
      from precios p
      where exists (select 1 from cita)
        and c.salon_id = ${salonId} and c.fecha = ${fecha} and c.timestamp = ${timestamp} and c.clienta = ${clienta}
        and c.deleted_at is null and c.tipo = p.tipo and c.item = p.nombre
      returning c.id
    )
    select (select count(*) from cita)::int as citas
  `;
  if (!r || r.citas === 0) {
    return res.status(404).json({ error: 'Cita no encontrada' });
  }

  return res.status(200).json({ success: true, total });
}

module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);
  if (!salonId) return;
  const { role, worker } = getSessionRole(req);

  try {
    const sql = getSql();

    if (req.method === 'GET' && req.query.anticipos !== undefined) {
      if (req.query.anticipos !== 'pendientes') {
        return res.status(400).json({ error: 'Consulta inválida' });
      }

      const rows = await sql`
        select id, fecha::text as fecha, clienta, total
        from citas
        where salon_id = ${salonId} and deleted_at is null
          and items @> ${SOLO_ANTICIPO}::jsonb
        order by fecha, timestamp
      `;

      const anticipos = rows.map((row) => ({
        id: row.id,
        clienta: row.clienta,
        fecha: row.fecha,
        monto: Number(row.total),
      }));

      return res.status(200).json({ anticipos });
    }

    if (req.method === 'GET') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { fecha } = req.query;
      if (!isDateStr(fecha)) {
        return res.status(400).json({ error: 'Falta o es inválida la fecha' });
      }

      const rows = await sql`
        select fecha::text as fecha, timestamp, clienta, items, total, metodo_pago, nota, anticipo, anticipo_origen_id, anticipo_aplicado
        from citas
        where salon_id = ${salonId} and fecha = ${fecha} and deleted_at is null
        order by timestamp
      `;

      const citas = rows.map((row) => ({
        fecha: row.fecha,
        timestamp: row.timestamp,
        clienta: row.clienta,
        items: row.items,
        total: Number(row.total),
        metodo_pago: row.metodo_pago,
        nota: row.nota || '',
        anticipo: Number(row.anticipo) || 0,
        anticipo_de_agenda: row.anticipo_origen_id != null,
        anticipo_aplicado: row.anticipo_aplicado != null ? Number(row.anticipo_aplicado) : 0,
      }));

      return res.status(200).json({ citas });
    }

    if (req.method === 'POST') {
      const { fecha, timestamp, clienta, items, total, metodo_pago, nota, comisiones, anticipo, anticipo_origen_id } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200) ||
          !isFiniteNumber(total, { min: 0, max: 10_000_000 }) || !isMetodoPago(metodo_pago)) {
        return res.status(400).json({ error: 'Faltan datos requeridos o son inválidos' });
      }
      if (!validarItems(items)) {
        return res.status(400).json({ error: 'Items inválidos' });
      }
      if (!validarComisiones(comisiones)) {
        return res.status(400).json({ error: 'Comisiones inválidas' });
      }
      if (role === 'trabajadora' && comisiones && comisiones.some((c) => c.trabajadora !== worker)) {
        return res.status(400).json({ error: 'Solo puedes asignarte comisión a ti misma' });
      }
      if (nota !== undefined && (typeof nota !== 'string' || nota.length > 2000)) {
        return res.status(400).json({ error: 'Nota inválida' });
      }
      if (anticipo !== undefined && !isFiniteNumber(anticipo, { min: 0, max: 10_000_000 })) {
        return res.status(400).json({ error: 'Anticipo inválido' });
      }
      const montoAnticipo = Number(anticipo || 0);
      if (montoAnticipo > Number(total)) {
        return res.status(400).json({ error: 'El anticipo no puede ser mayor que el total' });
      }
      if (anticipo_origen_id !== undefined && !isUuid(anticipo_origen_id)) {
        return res.status(400).json({ error: 'Anticipo de origen inválido' });
      }
      if (anticipo_origen_id !== undefined && montoAnticipo <= 0) {
        return res.status(400).json({ error: 'Falta el monto del anticipo' });
      }

      // Todo en una sola sentencia (atómica):
      // 1. Si el anticipo ya estaba registrado como fila propia (Agenda
      //    vieja), esa fila se oculta con candado: solo si sigue viva, es de
      //    este salón y su monto coincide. Si otro dispositivo ya la aplicó,
      //    no encuentra filas...
      // 2. ...y entonces tampoco se inserta la cita (se rechaza en vez de
      //    contar el anticipo dos veces).
      // 3. Las comisiones solo se insertan si la cita se insertó.
      // Si cualquier paso truena, Postgres deshace los tres.
      const origenId = anticipo_origen_id || null;
      const comisionesJson = JSON.stringify((comisiones || []).map((c) => ({
        trabajadora: c.trabajadora, item: c.item, tipo: c.tipo,
        costo: Number(c.costo), pct: Number(c.pct), comision: Number(c.comision),
      })));
      const nombre = clienta.trim();

      const [resultado] = await sql`
        with origen as (
          update citas set deleted_at = now()
          where ${origenId}::uuid is not null
            and id = ${origenId}::uuid and salon_id = ${salonId} and deleted_at is null
            and items @> ${SOLO_ANTICIPO}::jsonb and total = ${montoAnticipo}::numeric
          returning id
        ),
        nueva as (
          insert into citas (salon_id, fecha, timestamp, clienta, items, total, metodo_pago, nota, anticipo, anticipo_origen_id)
          select ${salonId}, ${fecha}, ${timestamp}, ${nombre}, ${JSON.stringify(items)}::jsonb, ${total}, ${metodo_pago},
                 ${nota || ''}, ${montoAnticipo}::numeric, ${origenId}::uuid
          where ${origenId}::uuid is null or exists (select 1 from origen)
          returning id
        ),
        nuevas_comisiones as (
          insert into comisiones (salon_id, fecha, timestamp, clienta, trabajadora, item, tipo, costo, pct, comision)
          select ${salonId}, ${fecha}, ${timestamp}, ${nombre}, c.trabajadora, c.item, c.tipo, c.costo, c.pct, c.comision
          from jsonb_to_recordset(${comisionesJson}::jsonb)
            as c(trabajadora text, item text, tipo text, costo numeric, pct numeric, comision numeric)
          where exists (select 1 from nueva)
          returning id
        )
        select (select count(*) from nueva)::int as citas
      `;

      if (!resultado || resultado.citas === 0) {
        return res.status(409).json({ error: 'Ese anticipo ya se aplicó a otra cita o ya no existe' });
      }

      // Avisarle a la dueña cuando una trabajadora registra una cita — ella
      // no ve Ver Registros, así que sin esto se enteraría hasta que
      // abriera la app. Si el push falla (sin VAPID configurado, sin
      // dispositivo suscrito) no debe tumbar el registro de la cita.
      if (role === 'trabajadora') {
        try {
          const montoFmt = `$${Number(total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          await enviarPushSalon(sql, salonId, {
            title: 'Nueva cita registrada',
            body: `${worker} registró una cita de ${nombre} — ${montoFmt}`,
            url: '/#registros',
          });
        } catch (error) {
          console.error('Error mandando push de cita nueva:', error.message);
        }
      }

      return res.status(201).json({ success: true });
    }

    if (req.method === 'PATCH') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { fecha, timestamp, clienta, nota, restore, items, anticipo } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos para identificar la cita' });
      }

      // restore: deshacer un DELETE reciente (el botón "Deshacer" del toast).
      // Si la cita traía un anticipo de la Agenda vieja, esa fila vuelve a
      // ocultarse con ella. Si mientras tanto ese anticipo ya se aplicó a
      // otra cita, no se restaura (se contaría dos veces).
      if (restore === true) {
        const [r] = await sql`
          with objetivo as (
            select id, anticipo_origen_id from citas
            where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
              and deleted_at is not null
          ),
          ocupado as (
            select 1 from objetivo o join citas a on a.id = o.anticipo_origen_id
            where a.deleted_at is not null
          ),
          origen as (
            update citas set deleted_at = now()
            where id in (select anticipo_origen_id from objetivo) and salon_id = ${salonId}
              and deleted_at is null and not exists (select 1 from ocupado)
            returning id
          ),
          restaurada as (
            update citas set deleted_at = null
            where id in (select id from objetivo) and not exists (select 1 from ocupado)
            returning id
          )
          select (select count(*) from objetivo)::int as encontradas,
                 (select count(*) from restaurada)::int as restauradas
        `;
        if (!r || r.encontradas === 0) {
          return res.status(404).json({ error: 'Cita no encontrada o ya no se puede restaurar' });
        }
        if (r.restauradas === 0) {
          return res.status(409).json({ error: 'Su anticipo ya se aplicó a otra cita; no se puede restaurar' });
        }

        // Las comisiones de esta cita se restauran junto con ella (ver DELETE).
        await sql`
          update comisiones set deleted_at = null
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is not null
        `;

        return res.status(200).json({ success: true });
      }

      if (items !== undefined) {
        return corregirPrecios(sql, res, salonId, { fecha, timestamp, clienta, items, anticipo });
      }

      // Una nota vacía es válida: sirve para borrarla
      if (typeof nota !== 'string' || nota.length > 2000) {
        return res.status(400).json({ error: 'Nota inválida' });
      }

      const rows = await sql`
        update citas set nota = ${nota}
        where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
          and deleted_at is null
        returning id
      `;

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cita no encontrada' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { fecha, timestamp, clienta } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos para identificar la cita' });
      }

      // Si la cita traía un anticipo de la Agenda vieja, esa fila vuelve a
      // quedar viva (pendiente de aplicar) en la misma sentencia: el dinero
      // sí se recibió, solo la cita fue un error.
      const [r] = await sql`
        with borrada as (
          update citas set deleted_at = now()
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is null
          returning id, anticipo_origen_id
        ),
        origen as (
          update citas set deleted_at = null
          where id in (select anticipo_origen_id from borrada) and salon_id = ${salonId}
            and deleted_at is not null
          returning id
        )
        select (select count(*) from borrada)::int as borradas
      `;

      if (!r || r.borradas === 0) {
        return res.status(404).json({ error: 'Cita no encontrada' });
      }

      // Las comisiones no llevan un id de cita enlazado — se identifican
      // igual que ella (salón + fecha + timestamp + clienta). Sin esto
      // quedaban huérfanas: seguían contando en Comisiones y en el Dashboard
      // aunque el ingreso ya no existiera.
      await sql`
        update comisiones set deleted_at = now()
        where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
          and deleted_at is null
      `;

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en citas:', error);
    res.status(500).json({ error: 'Error al procesar citas' });
  }
};
