/**
 * GET /api/dashboard
 * Resumen del negocio para un rango de fechas: ingresos vs. gastos por día,
 * ganancia neta real (ingresos - gastos - comisiones), y los rankings que
 * más le sirven a quien dirige el salón: servicios/productos más vendidos
 * y clientas de mayor gasto.
 *
 * GET ?desde=2026-09-01&hasta=2026-09-30 → {
 *   resumen: { ingresos, gastos, comisiones, utilidad_neta, num_citas, num_gastos },
 *   serie_diaria: [{ fecha, ingresos, gastos }, ...],
 *   top_servicios: [{ nombre, cantidad, total }, ...],
 *   top_productos: [{ nombre, cantidad, total }, ...],
 *   top_clientas: [{ nombre, visitas, total }, ...],
 * }
 * desde/hasta son opcionales (YYYY-MM-DD); si se omiten, es todo el historial.
 *
 * Todo se agrega en SQL (sum/group by), nunca trayendo cada cita a memoria:
 * a diferencia de /api/clientas (que sí necesita cada visita para mostrar
 * fórmulas e historial), aquí solo hacen falta los totales.
 *
 * Requiere `Authorization: Bearer <token>`.
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession } = require('../lib/auth');
const { isDateStr } = require('../lib/validate');

const TOP_N = 5;

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
    const d = desde || null;
    const h = hasta || null;

    const sql = getSql();

    const [citasPorDia, gastosPorDia, comisionesTotal, itemsAgg, clientasAgg] = await Promise.all([
      sql`
        select fecha::text as fecha, sum(total) as ingresos,
               count(*) filter (where not (items @> '[{"tipo":"anticipo"}]'::jsonb))::int as num_citas
        from citas
        where salon_id = ${salonId} and deleted_at is null
          and (${d}::date is null or fecha >= ${d}::date)
          and (${h}::date is null or fecha <= ${h}::date)
        group by fecha
        order by fecha
      `,
      sql`
        select fecha::text as fecha, sum(monto) as gastos, count(*)::int as num_gastos
        from gastos
        where salon_id = ${salonId} and deleted_at is null
          and (${d}::date is null or fecha >= ${d}::date)
          and (${h}::date is null or fecha <= ${h}::date)
        group by fecha
        order by fecha
      `,
      sql`
        select coalesce(sum(comision), 0) as total
        from comisiones
        where salon_id = ${salonId} and deleted_at is null
          and (${d}::date is null or fecha >= ${d}::date)
          and (${h}::date is null or fecha <= ${h}::date)
      `,
      sql`
        select item->>'tipo' as tipo, item->>'nombre' as nombre,
               count(*)::int as cantidad, sum((item->>'costo')::numeric) as total
        from citas, jsonb_array_elements(items) as item
        where salon_id = ${salonId} and deleted_at is null
          and (${d}::date is null or fecha >= ${d}::date)
          and (${h}::date is null or fecha <= ${h}::date)
          and item->>'tipo' <> 'anticipo'
        group by tipo, nombre
        order by total desc
      `,
      sql`
        select clienta, sum(total) as total,
               count(*) filter (where not (items @> '[{"tipo":"anticipo"}]'::jsonb))::int as visitas
        from citas
        where salon_id = ${salonId} and deleted_at is null
          and (${d}::date is null or fecha >= ${d}::date)
          and (${h}::date is null or fecha <= ${h}::date)
        group by clienta
        order by total desc
        limit ${TOP_N}
      `,
    ]);

    // Serie diaria: unir ingresos y gastos por fecha (dos agregados
    // separados porque son tablas distintas; el volumen por rango es
    // pequeño — como mucho un renglón por día).
    const porFecha = {};
    for (const row of citasPorDia) {
      porFecha[row.fecha] = { fecha: row.fecha, ingresos: Number(row.ingresos), gastos: 0 };
    }
    for (const row of gastosPorDia) {
      if (!porFecha[row.fecha]) porFecha[row.fecha] = { fecha: row.fecha, ingresos: 0, gastos: 0 };
      porFecha[row.fecha].gastos = Number(row.gastos);
    }
    const serie_diaria = Object.values(porFecha).sort((a, b) => a.fecha.localeCompare(b.fecha));

    const totalIngresos = citasPorDia.reduce((sum, r) => sum + Number(r.ingresos), 0);
    const totalGastos = gastosPorDia.reduce((sum, r) => sum + Number(r.gastos), 0);
    const totalComisiones = Number(comisionesTotal[0]?.total || 0);
    const numCitas = citasPorDia.reduce((sum, r) => sum + r.num_citas, 0);
    const numGastos = gastosPorDia.reduce((sum, r) => sum + r.num_gastos, 0);

    // itemsAgg ya viene ordenado por total desc; filtrar por tipo conserva el orden.
    const top_servicios = itemsAgg
      .filter((r) => r.tipo === 'servicio')
      .slice(0, TOP_N)
      .map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, total: Number(r.total) }));

    const top_productos = itemsAgg
      .filter((r) => r.tipo === 'producto')
      .slice(0, TOP_N)
      .map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, total: Number(r.total) }));

    const top_clientas = clientasAgg.map((r) => ({
      nombre: r.clienta,
      visitas: r.visitas,
      total: Number(r.total),
    }));

    return res.status(200).json({
      resumen: {
        ingresos: totalIngresos,
        gastos: totalGastos,
        comisiones: totalComisiones,
        utilidad_neta: totalIngresos - totalGastos - totalComisiones,
        num_citas: numCitas,
        num_gastos: numGastos,
      },
      serie_diaria,
      top_servicios,
      top_productos,
      top_clientas,
    });
  } catch (error) {
    console.error('Error en dashboard:', error);
    res.status(500).json({ error: 'Error al calcular el dashboard' });
  }
};
