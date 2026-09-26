/**
 * GET/POST /api/config
 * Lee o actualiza el catálogo de servicios, productos y trabajadoras.
 * GET  → { salon_nombre, logo_url, servicios, productos, trabajadoras }
 * POST { servicios, productos, trabajadoras } → { success }
 *
 * trabajadoras JSON almacenado:
 *   [{"nombre":"Ana","pin_hash":"...","permisos":{"telefonos":true}}, ...]
 * (pin_hash y permisos son opcionales y se asignan desde
 * /api/trabajador-pin, NUNCA desde aquí). GET nunca devuelve el hash: cada
 * trabajadora sale como {nombre, tiene_acceso, permisos}.
 * POST reemplaza el arreglo completo como siempre, pero conserva el
 * pin_hash y los permisos de cada quien por nombre — así editar servicios/
 * productos no le borra el acceso a nadie por accidente. Del cliente solo
 * se toma el nombre.
 *
 * Una trabajadora que sale de la lista pierde también sus dispositivos con
 * Face ID/Touch ID (si no, podía seguir entrando con biometría).
 *
 * Exclusivo de la dueña — fuera del alcance de una trabajadora.
 * Requiere `Authorization: Bearer <token>`; el salón se toma del token
 * verificado, nunca de un sheet_id que mande el cliente.
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession, sanitizeTrabajadoras } = require('../lib/auth');
const { isNonEmptyString } = require('../lib/validate');

const MAX_ITEMS = 300;

function validarCatalogo(list, maxLen) {
  if (!Array.isArray(list) || list.length > MAX_ITEMS) return false;
  return list.every((s) => isNonEmptyString(s, maxLen));
}

function validarTrabajadoras(list) {
  if (!Array.isArray(list) || list.length > MAX_ITEMS) return false;
  return list.every((t) => t && isNonEmptyString(t.nombre, 200));
}

module.exports = async function handler(req, res) {
  const salonId = requireOwnerSession(req, res);
  if (!salonId) return;

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const rows = await sql`
        select nombre, logo_url, servicios, productos, trabajadoras
        from salones
        where id = ${salonId}
      `;
      const data = rows[0];

      if (!data) {
        return res.status(404).json({ error: 'Config no encontrada' });
      }

      return res.status(200).json({
        salon_nombre: data.nombre,
        logo_url: data.logo_url || '',
        servicios: data.servicios || [],
        productos: data.productos || [],
        trabajadoras: sanitizeTrabajadoras(data.trabajadoras),
      });
    }

    if (req.method === 'POST') {
      const { servicios, productos, trabajadoras } = req.body || {};

      if (!validarCatalogo(servicios || [], 200) || !validarCatalogo(productos || [], 200) ||
          !validarTrabajadoras(trabajadoras || [])) {
        return res.status(400).json({ error: 'Catálogo inválido' });
      }

      // El cliente nunca manda pin_hash (GET tampoco lo expone) — sin esto,
      // guardar el catálogo por cualquier otro motivo (agregar un servicio,
      // por ejemplo) le borraría el acceso a quien ya lo tenía.
      const [actual] = await sql`select trabajadoras from salones where id = ${salonId}`;
      const actuales = new Map((actual?.trabajadoras || []).map((t) => [t.nombre, t]));
      const trabajadorasConAcceso = (trabajadoras || []).map((t) => {
        const previa = actuales.get(t.nombre);
        const fila = { nombre: t.nombre };
        if (previa?.pin_hash) fila.pin_hash = previa.pin_hash;
        if (previa?.permisos) fila.permisos = previa.permisos;
        return fila;
      });

      await sql`
        update salones
        set servicios = ${JSON.stringify(servicios || [])}::jsonb,
            productos = ${JSON.stringify(productos || [])}::jsonb,
            trabajadoras = ${JSON.stringify(trabajadorasConAcceso)}::jsonb
        where id = ${salonId}
      `;

      const nombresNuevos = new Set((trabajadoras || []).map((t) => t.nombre));
      const eliminadas = (actual?.trabajadoras || []).map((t) => t.nombre).filter((n) => !nombresNuevos.has(n));
      if (eliminadas.length > 0) {
        await sql`
          delete from webauthn_credentials
          where salon_id = ${salonId} and role = 'trabajadora' and worker = any(${eliminadas})
        `;
      }

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en config:', error);
    res.status(500).json({ error: 'Error al procesar configuración' });
  }
};
