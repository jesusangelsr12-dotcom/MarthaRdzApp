/**
 * GET/POST/PATCH/DELETE /api/citas
 * Lee citas de un día, registra, edita la nota o elimina (soft-delete) una cita.
 * GET    ?fecha=2026-02-24 → { citas: [...] }
 * POST   { fecha, timestamp, clienta, items, total, metodo_pago, nota?, comisiones?,
 *          agenda_id?, anticipo_aplicado? } → { success }
 * PATCH  { fecha, timestamp, clienta, nota } → { success }
 * DELETE { fecha, timestamp, clienta } → { success }
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
        select fecha::text as fecha, timestamp, clienta, items, total, metodo_pago, nota, anticipo_aplicado
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
        anticipo_aplicado: row.anticipo_aplicado != null ? Number(row.anticipo_aplicado) : 0,
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

      const { fecha, timestamp, clienta, nota, restore } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos para identificar la cita' });
      }

      // restore: deshacer un DELETE reciente (el botón "Deshacer" del toast).
      if (restore === true) {
        const rows = await sql`
          update citas set deleted_at = null
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is not null
          returning id
        `;
        if (rows.length === 0) {
          return res.status(404).json({ error: 'Cita no encontrada o ya no se puede restaurar' });
        }

        // Las comisiones de esta cita se restauran junto con ella (ver DELETE).
        await sql`
          update comisiones set deleted_at = null
          where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
            and deleted_at is not null
        `;

        return res.status(200).json({ success: true });
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

      const rows = await sql`
        update citas set deleted_at = now()
        where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and clienta = ${clienta}
          and deleted_at is null
        returning id
      `;

      if (rows.length === 0) {
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
