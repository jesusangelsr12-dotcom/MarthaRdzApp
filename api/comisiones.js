/**
 * GET /api/comisiones
 * Lee las comisiones registradas en un rango de fechas.
 * GET ?desde=2026-07-01&hasta=2026-07-31 → { comisiones: [...] }
 * desde/hasta son opcionales (formato YYYY-MM-DD). Si se omiten, devuelve todo.
 *
 * Requiere `Authorization: Bearer <token>`; el salón se toma del token
 * verificado, nunca de un sheet_id que mande el cliente.
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession } = require('../lib/auth');
const { isDateStr } = require('../lib/validate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Fuera del alcance de una trabajadora (ver plan de acceso limitado).
  const salonId = requireOwnerSession(req, res);
  if (!salonId) return;

  try {
    const { desde, hasta } = req.query;
    if ((desde && !isDateStr(desde)) || (hasta && !isDateStr(hasta))) {
      return res.status(400).json({ error: 'Rango de fechas inválido' });
    }

    const sql = getSql();
    const rows = await sql`
      select fecha::text as fecha, timestamp, clienta, trabajadora, item, tipo, costo, pct, comision
      from comisiones
      where salon_id = ${salonId} and deleted_at is null
        and (${desde || null}::date is null or fecha >= ${desde || null}::date)
        and (${hasta || null}::date is null or fecha <= ${hasta || null}::date)
      order by fecha
    `;

    const comisiones = rows.map((row) => ({
      fecha: row.fecha,
      timestamp: row.timestamp,
      clienta: row.clienta,
      trabajadora: row.trabajadora,
      item: row.item,
      tipo: row.tipo,
      costo: Number(row.costo) || 0,
      pct: Number(row.pct) || 0,
      comision: Number(row.comision) || 0,
    }));

    return res.status(200).json({ comisiones });
  } catch (error) {
    console.error('Error en comisiones:', error);
    res.status(500).json({ error: 'Error al obtener comisiones' });
  }
};
