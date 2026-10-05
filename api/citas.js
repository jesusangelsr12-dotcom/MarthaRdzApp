/**
 * GET/POST/PATCH/DELETE /api/citas
 * Lee citas de un día, registra, edita la nota o elimina (soft-delete) una cita.
 * GET    ?fecha=2026-02-24 → { citas: [...] }
 * POST   { fecha, timestamp, clienta, items, total, metodo_pago, nota?, comisiones?,
 *          agenda_id?, anticipo_aplicado? } → { success }
 * PATCH  { fecha, timestamp, clienta, nota } → { success }
 * PATCH  { fecha, timestamp, clienta, items, metodo_pago } → { success, total }
 *        Corrige el cobro: los precios de sus mismos items (no se agregan
 *        ni se quitan) y el método de pago. El servidor recalcula el total,
 *        el anticipo aplicado y las comisiones de esa cita, todo en una
 *        sola sentencia. Una fila de solo-anticipo no se corrige aquí: su
 *        monto vive en la cita agendada (se corrige desde la Agenda).
 * DELETE { fecha, timestamp, clienta, con_anticipo? } → { success }
 *        Si es el cobro de una cita agendada: sin `con_anticipo`, su anticipo
 *        se queda y la cita agendada vuelve a `pendiente` (para cobrarla de
 *        nuevo). Con `con_anticipo: true` se borran también su fila de
 *        anticipo y la cita agendada, como "Eliminar" en la Agenda. Todo en
 *        una sola sentencia; el restore (PATCH) lo regresa todo junto.
 *
 * Todas las llamadas requieren `Authorization: Bearer <token>` (emitido por
 * /api/login). El salón de cada consulta es SIEMPRE el del token verificado
 * — nunca un sheet_id que mande el cliente — así una sesión de un salón no
 * puede leer ni tocar los datos de otro.
 *
 * items es un JSON array: [{"tipo":"servicio","nombre":"Corte","costo":200}, ...]
 *
 * agenda_id/anticipo_aplicado: cuando la cita viene de un recuadro de "cita
 * agendada" (ver api/citas-agendadas.js), `total` ya trae el anticipo restado
 * (lo que de verdad se cobra hoy); `anticipo_aplicado` es solo para mostrar el
 * desglose en Ver Registros. Antes de insertar, se marca la cita agendada
 * como `completada` con un candado atómico (WHERE estado='pendiente') para
 * que no se pueda registrar la misma cita agendada dos veces. Marcarla,
 * insertar la cita e insertar sus comisiones es UNA sola sentencia (CTEs):
 * si algo falla, no queda una cita agendada completada sin su cobro.
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
 * Una trabajadora solo puede usar POST (registrar/cobrar una cita) y, si
 * manda comisiones, únicamente puede asignárselas a sí misma — Ver Registros
 * (GET) y editar/eliminar (PATCH/DELETE) son solo de la dueña.
 */

const { getSql } = require('../lib/db');
const { requireSession, getSessionRole } = require('../lib/auth');
const { isDateStr, isFiniteNumber, isNonEmptyString, isMetodoPago, isUuid } = require('../lib/validate');
const { enviarPushSalon } = require('../lib/push');

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

// Filas de `citas` que son solo el depósito de un anticipo (no una visita).
const SOLO_ANTICIPO = '[{"tipo":"anticipo"}]';

const redondear = (n) => Math.round(n * 100) / 100;

/** PATCH con `items`: corrige precios y método de pago de un cobro ya
 * registrado (ver el encabezado). */
async function corregirCobro(sql, res, salonId, { fecha, timestamp, clienta, items, metodo_pago }) {
  if (!validarItems(items)) {
    return res.status(400).json({ error: 'Items inválidos' });
  }
  if (!isMetodoPago(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }

  const actuales = await sql`
    select c.id, c.items, c.anticipo_aplicado, a.anticipo as anticipo_agenda
    from citas c
    left join citas_agendadas a on a.id = c.agenda_id and a.salon_id = c.salon_id
    where c.salon_id = ${salonId} and c.fecha = ${fecha} and c.timestamp = ${timestamp} and c.clienta = ${clienta}
      and c.deleted_at is null
  `;
  if (actuales.length === 0) {
    return res.status(404).json({ error: 'Cita no encontrada' });
  }
  if (actuales.length > 1) {
    return res.status(409).json({ error: 'Hay dos registros iguales a la misma hora; no se puede saber cuál corregir' });
  }

  const actual = actuales[0];
  const itemsActuales = Array.isArray(actual.items) ? actual.items : [];
  if (itemsActuales.some((it) => it.tipo === 'anticipo')) {
    return res.status(400).json({ error: 'El anticipo se corrige desde la Agenda' });
  }
  const mismosItems = itemsActuales.length === items.length &&
    itemsActuales.every((it, i) => it.tipo === items[i].tipo && it.nombre === items[i].nombre);
  if (!mismosItems) {
    return res.status(400).json({ error: 'Solo se pueden corregir los precios de esta cita' });
  }

  // Se conserva todo lo demás de cada item; solo cambia su precio.
  const nuevosItems = itemsActuales.map((it, i) => ({ ...it, costo: redondear(Number(items[i].costo)) }));
  const suma = redondear(nuevosItems.reduce((acc, it) => acc + it.costo, 0));

  // Si vino de una cita agendada, el anticipo se vuelve a aplicar sobre el
  // precio nuevo, igual que al cobrar: nunca más de lo que cuesta. Se parte
  // del anticipo de la cita agendada (el aplicado pudo haberse topado).
  let anticipoAplicado = null;
  if (actual.anticipo_aplicado != null) {
    const anticipo = Number(actual.anticipo_agenda ?? actual.anticipo_aplicado);
    anticipoAplicado = Math.min(anticipo, suma);
  }
  const total = redondear(suma - (anticipoAplicado || 0));
  const itemsJson = JSON.stringify(nuevosItems);

  // Cobro y comisiones juntos: la comisión sigue siendo el mismo % sobre el
  // precio completo de su item, como al registrar (ver cita.js).
  await sql`
    with cobro as (
      update citas
      set items = ${itemsJson}::jsonb, total = ${total}, metodo_pago = ${metodo_pago},
          anticipo_aplicado = ${anticipoAplicado}::numeric
      where id = ${actual.id} and deleted_at is null
      returning id
    ),
    comisiones_corregidas as (
      update comisiones co
      set costo = n.costo, comision = round(n.costo * co.pct / 100, 2)
      from jsonb_to_recordset(${itemsJson}::jsonb) as n(tipo text, nombre text, costo numeric)
      where exists (select 1 from cobro)
        and co.salon_id = ${salonId} and co.fecha = ${fecha} and co.timestamp = ${timestamp} and co.clienta = ${clienta}
        and co.deleted_at is null and co.item = n.nombre and co.tipo = n.tipo
      returning co.id
    )
    select (select count(*) from cobro)::int as citas
  `;

  return res.status(200).json({ success: true, total });
}

/** PATCH con `restore`: deshace un DELETE reciente (el "Deshacer" del
 * toast). Regresa la cita y sus comisiones y, si era el cobro de una cita
 * agendada, lo que se borró o cambió con él (ver DELETE). */
async function restaurarCita(sql, res, salonId, { fecha, timestamp, clienta }) {
  const borradas = await sql`
    select id, agenda_id, (items @> ${SOLO_ANTICIPO}::jsonb) as es_anticipo
    from citas
    where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
      and deleted_at is not null
    order by deleted_at desc
  `;
  if (borradas.length === 0) {
    return res.status(404).json({ error: 'Cita no encontrada o ya no se puede restaurar' });
  }

  const cobro = borradas.find((b) => b.agenda_id && !b.es_anticipo) || null;
  if (cobro) {
    // Si mientras tanto esa cita agendada se volvió a cobrar o cambió de
    // estado, regresar este cobro la dejaría cobrada dos veces o con un
    // cobro que no le corresponde.
    const [agenda] = await sql`
      select a.estado, a.deleted_at is null as viva,
             a.deleted_at is not null and a.deleted_at = (select deleted_at from citas where id = ${cobro.id}) as borrada_junto,
             exists (
               select 1 from citas o
               where o.agenda_id = a.id and o.salon_id = ${salonId} and o.deleted_at is null
                 and not (o.items @> ${SOLO_ANTICIPO}::jsonb)
             ) as otro_cobro
      from citas_agendadas a
      where a.id = ${cobro.agenda_id} and a.salon_id = ${salonId}
    `;
    const sePuede = agenda && !agenda.otro_cobro &&
      (agenda.borrada_junto || (agenda.viva && (agenda.estado === 'pendiente' || agenda.estado === 'completada')));
    if (!sePuede) {
      return res.status(409).json({ error: 'Esa cita de la Agenda ya cambió; no se puede deshacer' });
    }
  }
  const agendaId = cobro ? cobro.agenda_id : null;
  const cobroId = cobro ? cobro.id : null;

  // Todo junto, igual que el DELETE. Lo de la Agenda solo se regresa si se
  // borró en el mismo momento que el cobro (mismo deleted_at).
  await sql`
    with restaurada as (
      update citas set deleted_at = null
      where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
        and deleted_at is not null
      returning id
    ),
    comisiones_restauradas as (
      update comisiones set deleted_at = null
      where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
        and deleted_at is not null
      returning id
    ),
    anticipos as (
      update citas set deleted_at = null
      where ${agendaId}::uuid is not null and agenda_id = ${agendaId}::uuid and salon_id = ${salonId}
        and items @> ${SOLO_ANTICIPO}::jsonb
        and deleted_at = (select deleted_at from citas where id = ${cobroId}::uuid)
        and not (fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta})
      returning id
    ),
    agenda as (
      update citas_agendadas set deleted_at = null, estado = 'completada'
      where ${agendaId}::uuid is not null and id = ${agendaId}::uuid and salon_id = ${salonId}
        and (deleted_at = (select deleted_at from citas where id = ${cobroId}::uuid)
             or (deleted_at is null and estado = 'pendiente'))
      returning id
    )
    select (select count(*) from restaurada)::int as citas
  `;

  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);
  if (!salonId) return;
  const { role, worker } = getSessionRole(req);

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { fecha } = req.query;
      if (!isDateStr(fecha)) {
        return res.status(400).json({ error: 'Falta o es inválida la fecha' });
      }

      const rows = await sql`
        select c.fecha::text as fecha, c.timestamp, c.clienta, c.items, c.total, c.metodo_pago, c.nota,
               c.anticipo_aplicado, c.agenda_id, a.anticipo as anticipo_agenda,
               (select coalesce(sum(d.total), 0) from citas d
                where d.agenda_id = c.agenda_id and d.salon_id = c.salon_id and d.deleted_at is null
                  and d.items @> ${SOLO_ANTICIPO}::jsonb) as anticipo_registrado
        from citas c
        left join citas_agendadas a on a.id = c.agenda_id and a.salon_id = c.salon_id
        where c.salon_id = ${salonId} and c.fecha = ${fecha} and c.deleted_at is null
        order by c.timestamp
      `;

      const citas = rows.map((row) => ({
        fecha: row.fecha,
        timestamp: row.timestamp,
        clienta: row.clienta,
        items: row.items,
        total: Number(row.total),
        metodo_pago: row.metodo_pago,
        nota: row.nota || '',
        anticipo_aplicado: row.anticipo_aplicado != null ? Number(row.anticipo_aplicado) : 0,
        // Para que la Agenda pueda llevar directo al cobro de una cita
        // agendada, y para recalcular el anticipo al corregir el cobro.
        agenda_id: row.agenda_id || '',
        anticipo_agenda: row.anticipo_agenda != null ? Number(row.anticipo_agenda) : 0,
        // Anticipo de esa cita agendada que sigue vivo en ingresos: al
        // eliminar su cobro, la app pregunta si se borra también.
        anticipo_registrado: Number(row.anticipo_registrado) || 0,
      }));

      return res.status(200).json({ citas });
    }

    if (req.method === 'POST') {
      const { fecha, timestamp, clienta, items, total, metodo_pago, nota, comisiones, agenda_id, anticipo_aplicado } = req.body || {};

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
      if (agenda_id !== undefined && !isUuid(agenda_id)) {
        return res.status(400).json({ error: 'agenda_id inválido' });
      }
      if ((agenda_id !== undefined) !== (anticipo_aplicado !== undefined)) {
        return res.status(400).json({ error: 'agenda_id y anticipo_aplicado deben venir juntos' });
      }
      if (anticipo_aplicado !== undefined && !isFiniteNumber(anticipo_aplicado, { min: 0, max: 10_000_000 })) {
        return res.status(400).json({ error: 'anticipo_aplicado inválido' });
      }

      // Todo en una sola sentencia (atómica):
      // 1. Si viene de un recuadro de "cita agendada", la marca completada
      //    con candado: si otro dispositivo ya la completó (o no existe / no
      //    es de este salón), no encuentra filas...
      // 2. ...y entonces tampoco se inserta la cita (se rechaza en vez de
      //    duplicarla).
      // 3. Las comisiones solo se insertan si la cita se insertó.
      // Si cualquier paso truena, Postgres deshace los tres.
      const agendaId = agenda_id || null;
      const comisionesJson = JSON.stringify((comisiones || []).map((c) => ({
        trabajadora: c.trabajadora, item: c.item, tipo: c.tipo,
        costo: Number(c.costo), pct: Number(c.pct), comision: Number(c.comision),
      })));
      const nombre = clienta.trim();

      const [resultado] = await sql`
        with agenda as (
          update citas_agendadas set estado = 'completada'
          where ${agendaId}::uuid is not null
            and id = ${agendaId}::uuid and salon_id = ${salonId} and estado = 'pendiente' and deleted_at is null
          returning id
        ),
        nueva as (
          insert into citas (salon_id, fecha, timestamp, clienta, items, total, metodo_pago, nota, agenda_id, anticipo_aplicado)
          select ${salonId}, ${fecha}, ${timestamp}, ${nombre}, ${JSON.stringify(items)}::jsonb, ${total}, ${metodo_pago},
                 ${nota || ''}, ${agendaId}::uuid, ${anticipo_aplicado ?? null}::numeric
          where ${agendaId}::uuid is null or exists (select 1 from agenda)
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
        return res.status(400).json({ error: 'Esta cita agendada ya fue registrada o no existe' });
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
            body: `${worker} registró una cita de ${clienta.trim()} — ${montoFmt}`,
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

      const { fecha, timestamp, clienta, nota, restore, items, metodo_pago } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos para identificar la cita' });
      }

      if (items !== undefined) {
        return corregirCobro(sql, res, salonId, { fecha, timestamp, clienta, items, metodo_pago });
      }

      // restore: deshacer un DELETE reciente (el botón "Deshacer" del toast).
      if (restore === true) {
        return restaurarCita(sql, res, salonId, { fecha, timestamp, clienta });
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

      const { fecha, timestamp, clienta, con_anticipo } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos para identificar la cita' });
      }
      if (con_anticipo !== undefined && typeof con_anticipo !== 'boolean') {
        return res.status(400).json({ error: 'con_anticipo inválido' });
      }
      const conAnticipo = con_anticipo === true;

      // Una sola sentencia:
      // - La cita y sus comisiones. Las comisiones no llevan un id de cita
      //   enlazado: se identifican igual que ella (salón + fecha + timestamp
      //   + clienta). Sin esto seguían contando en Comisiones y Dashboard.
      // - Si era el cobro de una cita agendada (nunca la fila del anticipo):
      //   sin `con_anticipo` la cita agendada vuelve a pendiente y su
      //   anticipo se queda; con `con_anticipo` se borran su anticipo y la
      //   cita agendada. Antes se quedaba "completada" sin cobro (C15).
      // Todo lleva el mismo now(): así el restore sabe qué se borró junto.
      const [resultado] = await sql`
        with cobro as (
          update citas set deleted_at = now()
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is null
          returning id, agenda_id, items
        ),
        comisiones_borradas as (
          update comisiones set deleted_at = now()
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is null and exists (select 1 from cobro)
          returning id
        ),
        ligada as (
          select distinct agenda_id from cobro
          where agenda_id is not null and not (items @> ${SOLO_ANTICIPO}::jsonb)
        ),
        anticipos as (
          update citas set deleted_at = now()
          where ${conAnticipo} and salon_id = ${salonId} and deleted_at is null
            and items @> ${SOLO_ANTICIPO}::jsonb and agenda_id in (select agenda_id from ligada)
            and not (fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta})
          returning id
        ),
        agenda as (
          update citas_agendadas
          set deleted_at = case when ${conAnticipo} then now() else null end,
              estado = case when ${conAnticipo} then estado else 'pendiente' end
          where id in (select agenda_id from ligada) and salon_id = ${salonId}
            and deleted_at is null and estado = 'completada'
          returning id
        )
        select (select count(*) from cobro)::int as citas,
               (select count(*) from anticipos)::int as anticipos,
               (select count(*) from agenda)::int as agendas
      `;

      if (!resultado || resultado.citas === 0) {
        return res.status(404).json({ error: 'Cita no encontrada' });
      }

      return res.status(200).json({ success: true, anticipos: resultado.anticipos, agendas: resultado.agendas });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en citas:', error);
    res.status(500).json({ error: 'Error al procesar citas' });
  }
};
