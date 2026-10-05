/**
 * GET/POST/PATCH/DELETE /api/citas-agendadas
 * Citas agendadas (futuras) con anticipo opcional, y ausencias (vacaciones/
 * días libres de la dueña o de una trabajadora) — viven en el mismo
 * endpoint por el límite de Serverless Functions de Vercel Hobby (ver
 * api/webauthn.js para el mismo criterio). Se distinguen con `recurso:
 * 'ausencia'` en el body; sin ese campo, es una cita agendada (compatible
 * con las llamadas de siempre).
 *
 * GET    ?fecha=2026-09-20                  → citas agendadas + ausencias de ese día
 * GET    ?desde=2026-09-14&hasta=2026-09-20 → citas agendadas + ausencias en ese rango
 * GET    ...&estado=pendiente               → filtra las citas por estado (opcional; no aplica a ausencias)
 * POST   { clienta, fecha, hora, anticipo, anticipo_metodo_pago?, nota?, timestamp }
 *        → agenda la cita; si anticipo > 0, además registra ese dinero como
 *        ingreso de HOY en `citas` (un solo item {tipo:'anticipo', ...}), todo
 *        en una sola sentencia con CTEs para que no se pueda perder el
 *        anticipo si algo falla a medio camino.
 * POST   { recurso: 'ausencia', trabajadora?, desde, hasta, nota? }
 *        → marca días libres/vacaciones. Sin `trabajadora` es de la dueña.
 * PATCH  { id, restore } | { id, estado?, nota?, fecha?, hora? } → deshacer un
 *        borrado, o cambiar estado (nunca a "completada" por aquí — eso solo
 *        pasa dentro de POST /api/citas) / editar logística.
 * PATCH  { id, anticipo, anticipo_metodo_pago?, timestamp?, nota? } → corregir
 *        el anticipo (y de paso la nota). Su fila de ingreso en `citas` se
 *        corrige, se crea (fecha de hoy, por eso `timestamp`) o se borra en
 *        la misma sentencia. No aplica a una cita `completada`: ahí el
 *        anticipo ya se descontó de su cobro.
 * PATCH  { recurso: 'ausencia', id, restore: true } → deshacer su borrado.
 * DELETE { id } → borrado lógico (para una entrada mal capturada; para
 *        "la clienta no llegó" o "se canceló" usar PATCH con `estado`). Si
 *        tenía anticipo, también se borra su fila de ingreso en `citas`
 *        (la del item `anticipo` con su agenda_id) — a diferencia de
 *        "cancelar"/"no asistió", que sí lo conservan porque el dinero se
 *        recibió de verdad. El restore (PATCH con `restore: true`) recupera
 *        ambas filas juntas.
 *        Una cita ya `completada` no se puede eliminar aquí (400): su cobro
 *        también lleva agenda_id y se habría borrado con ella. Para
 *        corregirla, se elimina el cobro desde Ver Registros.
 * DELETE { recurso: 'ausencia', id } → borrado lógico de la ausencia.
 *
 * El anticipo se registra con la fecha de hoy en México (lib/fecha.js), no
 * la de UTC: después de las 6 pm de México, en UTC ya es mañana.
 *
 * Requiere `Authorization: Bearer <token>`; el salón se toma del token
 * verificado, nunca de un sheet_id que mande el cliente.
 *
 * Una trabajadora puede ver el calendario completo (GET, citas Y ausencias)
 * y agendar citas (POST cita) — pero reagendar/cambiar estado/eliminar
 * citas (PATCH/DELETE) y todo lo de ausencias (POST/PATCH/DELETE) son solo
 * de la dueña: marcar vacaciones es una decisión de administración del
 * salón, no algo que le toque decidir a quien registra citas.
 */

const crypto = require('crypto');
const { getSql } = require('../lib/db');
const { requireSession, getSessionRole } = require('../lib/auth');
const {
  isDateStr,
  isTimeStr,
  isFiniteNumber,
  isNonEmptyString,
  isMetodoPago,
  isEstadoAgenda,
} = require('../lib/validate');
const { fechaMexico } = require('../lib/fecha');

// Filas de `citas` que son solo el depósito de un anticipo (no una visita).
const SOLO_ANTICIPO = '[{"tipo":"anticipo"}]';

/** Trae las ausencias que se traslapan con [d, h] (cualquiera puede venir
 * null — mismo criterio de "sin límite en ese extremo" que ya usa la
 * consulta de citas_agendadas de abajo). */
async function fetchAusencias(sql, salonId, d, h) {
  const rows = await sql`
    select id, trabajadora, desde::text as desde, hasta::text as hasta, nota
    from ausencias
    where salon_id = ${salonId} and deleted_at is null
      and (${h}::date is null or desde <= ${h}::date)
      and (${d}::date is null or hasta >= ${d}::date)
    order by desde
  `;
  return rows.map((row) => ({
    id: row.id,
    trabajadora: row.trabajadora || '',
    desde: row.desde,
    hasta: row.hasta,
    nota: row.nota || '',
  }));
}

module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);
  if (!salonId) return;
  const { role } = getSessionRole(req);

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const { fecha, desde, hasta, estado } = req.query;
      const d = fecha || desde || null;
      const h = fecha || hasta || null;

      if (!d && !h) {
        return res.status(400).json({ error: 'Falta fecha o desde/hasta' });
      }
      if ((d && !isDateStr(d)) || (h && !isDateStr(h))) {
        return res.status(400).json({ error: 'Fecha inválida' });
      }
      if (estado && !isEstadoAgenda(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      const [rows, ausencias] = await Promise.all([
        sql`
          select id, clienta, fecha::text as fecha, hora, anticipo, anticipo_metodo_pago, nota, estado
          from citas_agendadas
          where salon_id = ${salonId} and deleted_at is null
            and (${d}::date is null or fecha >= ${d}::date)
            and (${h}::date is null or fecha <= ${h}::date)
            and (${estado || null}::text is null or estado = ${estado || null})
          order by fecha, hora
        `,
        fetchAusencias(sql, salonId, d, h),
      ]);

      const citas_agendadas = rows.map((row) => ({
        id: row.id,
        clienta: row.clienta,
        fecha: row.fecha,
        hora: row.hora,
        anticipo: Number(row.anticipo),
        anticipo_metodo_pago: row.anticipo_metodo_pago || '',
        nota: row.nota || '',
        estado: row.estado,
      }));

      return res.status(200).json({ citas_agendadas, ausencias });
    }

    if (req.method === 'POST' && req.body?.recurso === 'ausencia') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { trabajadora, desde, hasta, nota } = req.body || {};

      if (!isDateStr(desde) || !isDateStr(hasta) || hasta < desde) {
        return res.status(400).json({ error: 'Rango de fechas inválido' });
      }
      if (trabajadora !== undefined && trabajadora !== null && trabajadora !== '' && !isNonEmptyString(trabajadora, 200)) {
        return res.status(400).json({ error: 'Trabajadora inválida' });
      }
      if (nota !== undefined && (typeof nota !== 'string' || nota.length > 2000)) {
        return res.status(400).json({ error: 'Nota inválida' });
      }

      const rows = await sql`
        insert into ausencias (salon_id, trabajadora, desde, hasta, nota)
        values (${salonId}, ${trabajadora || null}, ${desde}, ${hasta}, ${nota || ''})
        returning id
      `;

      return res.status(201).json({ success: true, id: rows[0]?.id });
    }

    if (req.method === 'POST') {
      const { clienta, fecha, hora, anticipo, anticipo_metodo_pago, nota, timestamp } = req.body || {};

      if (!isNonEmptyString(clienta, 200) || !isDateStr(fecha) || !isTimeStr(hora) ||
          !isFiniteNumber(anticipo, { min: 0, max: 10_000_000 }) || !isNonEmptyString(timestamp, 20)) {
        return res.status(400).json({ error: 'Faltan datos requeridos o son inválidos' });
      }
      const tieneAnticipo = Number(anticipo) > 0;
      if (tieneAnticipo && !isMetodoPago(anticipo_metodo_pago)) {
        return res.status(400).json({ error: 'Falta el método de pago del anticipo' });
      }
      if (!tieneAnticipo && anticipo_metodo_pago) {
        return res.status(400).json({ error: 'No debe haber método de pago sin anticipo' });
      }
      if (nota !== undefined && (typeof nota !== 'string' || nota.length > 2000)) {
        return res.status(400).json({ error: 'Nota inválida' });
      }

      const nombreClienta = clienta.trim();
      const hoy = fechaMexico();
      const itemAnticipo = JSON.stringify([
        { tipo: 'anticipo', nombre: `Anticipo — ${nombreClienta}`, costo: Number(anticipo) },
      ]);
      const notaDeposito = `Anticipo de cita agendada para el ${fecha} ${hora}`;
      const metodoAnticipo = tieneAnticipo ? anticipo_metodo_pago : null;

      const rows = await sql`
        with nueva_agenda as (
          insert into citas_agendadas (salon_id, clienta, fecha, hora, anticipo, anticipo_metodo_pago, nota)
          values (${salonId}, ${nombreClienta}, ${fecha}, ${hora}, ${anticipo}, ${metodoAnticipo}, ${nota || ''})
          returning id
        ),
        nueva_cita as (
          insert into citas (salon_id, fecha, timestamp, clienta, items, total, metodo_pago, nota, agenda_id)
          select ${salonId}, ${hoy}, ${timestamp}, ${nombreClienta}, ${itemAnticipo}::jsonb, ${anticipo}, ${metodoAnticipo}, ${notaDeposito}, nueva_agenda.id
          from nueva_agenda
          where ${tieneAnticipo}
          returning id, agenda_id
        ),
        agenda_actualizada as (
          update citas_agendadas
          set deposito_cita_id = nueva_cita.id
          from nueva_cita
          where citas_agendadas.id = nueva_cita.agenda_id
          returning citas_agendadas.id
        )
        select nueva_agenda.id as id from nueva_agenda
      `;

      return res.status(201).json({ success: true, id: rows[0]?.id });
    }

    if (req.method === 'PATCH' && req.body?.recurso === 'ausencia') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { id, restore } = req.body || {};
      if (!isNonEmptyString(id, 100) || restore !== true) {
        return res.status(400).json({ error: 'Solicitud inválida' });
      }

      const rows = await sql`
        update ausencias set deleted_at = null
        where id = ${id} and salon_id = ${salonId} and deleted_at is not null
        returning id
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'No se encontró o ya no se puede restaurar' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE' && req.body?.recurso === 'ausencia') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { id } = req.body || {};
      if (!isNonEmptyString(id, 100)) {
        return res.status(400).json({ error: 'Falta el id de la ausencia' });
      }

      const rows = await sql`
        update ausencias set deleted_at = now()
        where id = ${id} and salon_id = ${salonId} and deleted_at is null
        returning id
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Ausencia no encontrada' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'PATCH') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { id, restore, estado, nota, fecha, hora, anticipo, anticipo_metodo_pago, timestamp } = req.body || {};

      if (!isNonEmptyString(id, 100)) {
        return res.status(400).json({ error: 'Falta el id de la cita agendada' });
      }

      if (restore === true) {
        const rows = await sql`
          update citas_agendadas set deleted_at = null
          where id = ${id} and salon_id = ${salonId} and deleted_at is not null
          returning id
        `;
        if (rows.length === 0) {
          return res.status(404).json({ error: 'No se encontró o ya no se puede restaurar' });
        }

        // El anticipo (si lo hubo) se restaura junto con la cita agendada (ver DELETE).
        await sql`
          update citas set deleted_at = null
          where agenda_id = ${id} and salon_id = ${salonId} and deleted_at is not null
            and items @> ${SOLO_ANTICIPO}::jsonb
        `;

        return res.status(200).json({ success: true });
      }

      if (estado !== undefined && (!isEstadoAgenda(estado) || estado === 'completada')) {
        return res.status(400).json({ error: 'Estado inválido' });
      }
      if (nota !== undefined && (typeof nota !== 'string' || nota.length > 2000)) {
        return res.status(400).json({ error: 'Nota inválida' });
      }
      if (fecha !== undefined && !isDateStr(fecha)) {
        return res.status(400).json({ error: 'Fecha inválida' });
      }
      if (hora !== undefined && !isTimeStr(hora)) {
        return res.status(400).json({ error: 'Hora inválida' });
      }
      if (estado === undefined && nota === undefined && fecha === undefined && hora === undefined && anticipo === undefined) {
        return res.status(400).json({ error: 'Nada que actualizar' });
      }

      if (anticipo !== undefined) {
        if (!isFiniteNumber(anticipo, { min: 0, max: 10_000_000 })) {
          return res.status(400).json({ error: 'Anticipo inválido' });
        }
        const tieneAnticipo = Number(anticipo) > 0;
        if (tieneAnticipo && !isMetodoPago(anticipo_metodo_pago)) {
          return res.status(400).json({ error: 'Falta el método de pago del anticipo' });
        }
        if (!tieneAnticipo && anticipo_metodo_pago) {
          return res.status(400).json({ error: 'No debe haber método de pago sin anticipo' });
        }
        if (tieneAnticipo && !isNonEmptyString(timestamp, 20)) {
          return res.status(400).json({ error: 'Faltan datos requeridos o son inválidos' });
        }

        // Corregir el anticipo mueve dinero: la cita agendada y su fila de
        // ingreso en `citas` cambian juntas, en una sola sentencia (igual
        // que el POST), para que nunca digan montos distintos.
        // - Ya tenía fila de anticipo y sigue habiendo anticipo → se
        //   corrige esa fila en su mismo día (es una corrección, no dinero
        //   nuevo).
        // - No tenía (o se borró en Ver Registros) → se registra hoy.
        // - Pasa a $0 → se borra la fila (lógico) y se suelta de la cita,
        //   para que un "Deshacer" de eliminar la cita no la reviva.
        // Una cita completada no entra: su anticipo ya se descontó del cobro.
        const metodoAnticipo = tieneAnticipo ? anticipo_metodo_pago : null;
        const nuevoDepositoId = crypto.randomUUID();
        const hoy = fechaMexico();

        const rows = await sql`
          with deposito_actual as (
            select c.id from citas c
            join citas_agendadas a on a.id = c.agenda_id
            where c.agenda_id = ${id} and c.salon_id = ${salonId} and c.deleted_at is null
              and c.items @> ${SOLO_ANTICIPO}::jsonb
              and a.salon_id = ${salonId} and a.deleted_at is null and a.estado <> 'completada'
          ),
          agenda as (
            update citas_agendadas
            set anticipo = ${anticipo},
                anticipo_metodo_pago = ${metodoAnticipo},
                deposito_cita_id = case
                  when not ${tieneAnticipo} then null
                  else coalesce((select id from deposito_actual limit 1), ${nuevoDepositoId}::uuid)
                end,
                estado = coalesce(${estado ?? null}, estado),
                nota = coalesce(${nota ?? null}, nota),
                fecha = coalesce(${fecha ?? null}::date, fecha),
                hora = coalesce(${hora ?? null}, hora)
            where id = ${id} and salon_id = ${salonId} and deleted_at is null and estado <> 'completada'
            returning id, clienta, fecha::text as fecha, hora
          ),
          corregido as (
            update citas
            set items = jsonb_set(items, '{0,costo}', to_jsonb(${anticipo}::numeric)),
                total = ${anticipo},
                metodo_pago = ${metodoAnticipo}
            where ${tieneAnticipo} and id in (select id from deposito_actual)
              and exists (select 1 from agenda)
            returning id
          ),
          quitado as (
            update citas set deleted_at = now(), agenda_id = null
            where not ${tieneAnticipo} and id in (select id from deposito_actual)
              and exists (select 1 from agenda)
            returning id
          ),
          nuevo as (
            insert into citas (id, salon_id, fecha, timestamp, clienta, items, total, metodo_pago, nota, agenda_id)
            select ${nuevoDepositoId}::uuid, ${salonId}, ${hoy}, ${timestamp ?? null}, agenda.clienta,
                   jsonb_build_array(jsonb_build_object('tipo', 'anticipo', 'nombre', 'Anticipo — ' || agenda.clienta, 'costo', ${anticipo}::numeric)),
                   ${anticipo}, ${metodoAnticipo},
                   'Anticipo de cita agendada para el ' || agenda.fecha || ' ' || agenda.hora, agenda.id
            from agenda
            where ${tieneAnticipo} and not exists (select 1 from deposito_actual)
            returning id
          )
          select agenda.id,
                 (select count(*) from corregido)::int as corregidos,
                 (select count(*) from quitado)::int as quitados,
                 (select count(*) from nuevo)::int as nuevos
          from agenda
        `;

        if (rows.length === 0) {
          return res.status(404).json({ error: 'Cita agendada no encontrada o ya completada' });
        }

        return res.status(200).json({ success: true });
      }

      const rows = await sql`
        update citas_agendadas
        set estado = coalesce(${estado ?? null}, estado),
            nota = coalesce(${nota ?? null}, nota),
            fecha = coalesce(${fecha ?? null}::date, fecha),
            hora = coalesce(${hora ?? null}, hora)
        where id = ${id} and salon_id = ${salonId} and deleted_at is null and estado <> 'completada'
        returning id
      `;

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cita agendada no encontrada o ya completada' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { id } = req.body || {};
      if (!isNonEmptyString(id, 100)) {
        return res.status(400).json({ error: 'Falta el id de la cita agendada' });
      }

      const rows = await sql`
        update citas_agendadas set deleted_at = now()
        where id = ${id} and salon_id = ${salonId} and deleted_at is null and estado <> 'completada'
        returning id
      `;

      if (rows.length === 0) {
        const [existe] = await sql`
          select estado from citas_agendadas where id = ${id} and salon_id = ${salonId} and deleted_at is null
        `;
        if (existe?.estado === 'completada') {
          return res.status(400).json({ error: 'Esta cita ya se cobró. Para corregirla, elimina el cobro desde Ver Registros' });
        }
        return res.status(404).json({ error: 'Cita agendada no encontrada' });
      }

      // DELETE es para un error de captura real (a diferencia de "cancelar",
      // que conserva el anticipo porque el dinero sí se recibió). Si esta
      // cita agendada tenía un anticipo, esa fila de ingreso en `citas`
      // también fue un error y debe desaparecer con ella. Solo la fila del
      // anticipo: nunca un cobro (el candado de arriba ya lo impide, esto es
      // la segunda barrera).
      await sql`
        update citas set deleted_at = now()
        where agenda_id = ${id} and salon_id = ${salonId} and deleted_at is null
          and items @> ${SOLO_ANTICIPO}::jsonb
      `;

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en citas-agendadas:', error);
    res.status(500).json({ error: 'Error al procesar la agenda' });
  }
};
