/**
 * GET/POST/PATCH/DELETE /api/gastos
 * Lee gastos de un día, registra un nuevo gasto, lo elimina (soft-delete) o
 * lo restaura (deshacer un DELETE reciente).
 * GET    ?fecha=2026-02-24 → { gastos: [...] }
 * POST   { fecha, timestamp, descripcion, monto, metodo_pago } → { success }
 * PATCH  { fecha, timestamp, descripcion, restore: true } → { success }
 * DELETE { fecha, timestamp, descripcion } → { success }
 *
 * Todas las llamadas requieren `Authorization: Bearer <token>` (emitido por
 * /api/login); el salón se toma del token verificado, nunca de un sheet_id
 * que mande el cliente.
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession } = require('../lib/auth');
const { isDateStr, isFiniteNumber, isNonEmptyString, isMetodoPago } = require('../lib/validate');

module.exports = async function handler(req, res) {
  // Fuera del alcance de una trabajadora (ver plan de acceso limitado).
  const salonId = requireOwnerSession(req, res);
  if (!salonId) return;

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const { fecha } = req.query;
      if (!isDateStr(fecha)) {
        return res.status(400).json({ error: 'Falta o es inválida la fecha' });
      }

      const rows = await sql`
        select fecha::text as fecha, timestamp, descripcion, monto, metodo_pago
        from gastos
        where salon_id = ${salonId} and fecha = ${fecha} and deleted_at is null
        order by timestamp
      `;

      const gastos = rows.map((row) => ({
        fecha: row.fecha,
        timestamp: row.timestamp,
        descripcion: row.descripcion,
        monto: Number(row.monto),
        metodo_pago: row.metodo_pago,
      }));

      return res.status(200).json({ gastos });
    }

    if (req.method === 'POST') {
      const { fecha, timestamp, descripcion, monto, metodo_pago } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(descripcion, 300) ||
          !isFiniteNumber(monto, { min: 0, max: 10_000_000 }) || !isMetodoPago(metodo_pago)) {
        return res.status(400).json({ error: 'Faltan datos requeridos o son inválidos' });
      }

      await sql`
        insert into gastos (salon_id, fecha, timestamp, descripcion, monto, metodo_pago)
        values (${salonId}, ${fecha}, ${timestamp}, ${descripcion.trim()}, ${monto}, ${metodo_pago})
      `;

      return res.status(201).json({ success: true });
    }

    if (req.method === 'PATCH') {
      const { fecha, timestamp, descripcion, restore } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(descripcion, 300)) {
        return res.status(400).json({ error: 'Faltan datos para identificar el gasto' });
      }
      if (restore !== true) {
        return res.status(400).json({ error: 'Operación inválida' });
      }

      const rows = await sql`
        update gastos set deleted_at = null
        where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and descripcion = ${descripcion}
          and deleted_at is not null
        returning id
      `;

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Gasto no encontrado o ya no se puede restaurar' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { fecha, timestamp, descripcion } = req.body || {};

      if (!isDateStr(fecha) || !isNonEmptyString(timestamp, 20) || !isNonEmptyString(descripcion, 300)) {
        return res.status(400).json({ error: 'Faltan datos para identificar el gasto' });
      }

      const rows = await sql`
        update gastos set deleted_at = now()
        where salon_id = ${salonId} and fecha = ${fecha} and timestamp = ${timestamp} and descripcion = ${descripcion}
          and deleted_at is null
        returning id
      `;

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Gasto no encontrado' });
      }

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en gastos:', error);
    res.status(500).json({ error: 'Error al procesar gastos' });
  }
};
