/**
 * POST /api/login
 * Valida un PIN de 6 dígitos buscando en todos los salones registrados y,
 * si es correcto, emite un token de sesión firmado (8h) que el resto de la
 * API exige en cada llamada.
 *
 * Body: { pin }  — el PIN en crudo; el hash con pepper se calcula aquí,
 * nunca en el cliente (antes el frontend mandaba un SHA-256 sin salt/pepper
 * que cualquiera podía recalcular con el algoritmo público).
 *
 * Si el PIN no es de ninguna dueña, se busca también entre los PINs de
 * trabajadoras (`salones.trabajadoras[].pin_hash`, asignados desde
 * Configuración) — misma búsqueda "global" sin selector de salón. Si
 * coincide, el token se emite con role: 'trabajadora' y su nombre; el
 * resto de la API usa eso para limitar qué puede ver/hacer.
 *
 * Respuesta: { success, token, salon_id, salon_nombre, sheet_id, logo_url,
 *              servicios, productos, trabajadoras, role, worker_nombre }
 *
 * `sheet_id` se mantiene como nombre de campo por compatibilidad con el
 * frontend: es el id (uuid) del salón en la base de datos.
 */

const { getSql } = require('../lib/db');
const { createSessionToken, legacySha256, pepperedPinHash, sanitizeTrabajadoras } = require('../lib/auth');

const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_MINUTOS = 15;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconocida';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const sql = getSql();
  const ip = getClientIp(req);

  try {
    // Rate limit: bloquea intentos de fuerza bruta por IP (el PIN es de
    // solo 6 dígitos, así que sin esto se puede probar el millón de
    // combinaciones en minutos).
    const [{ intentos }] = await sql`
      select count(*)::int as intentos
      from login_attempts
      where ip = ${ip}
        and success = false
        and attempted_at > now() - interval '15 minutes'
    `;
    if (intentos >= MAX_INTENTOS_FALLIDOS) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
    }

    const { pin } = req.body || {};
    if (!pin || !/^\d{6}$/.test(String(pin))) {
      await sql`insert into login_attempts (ip, success) values (${ip}, false)`;
      return res.status(400).json({ error: 'PIN inválido' });
    }

    const peppered = pepperedPinHash(pin);

    let rows = await sql`
      select id, salon_id, nombre, logo_url, servicios, productos, trabajadoras
      from salones
      where pin_hash_v2 = ${peppered}
      limit 1
    `;
    let salon = rows[0];

    // Fallback a salones que todavía no se migraron al esquema con pepper
    // (creados antes de esta migración). Si el PIN es correcto, se
    // actualiza silenciosamente para que la próxima vez use el nuevo hash.
    if (!salon) {
      const legacy = legacySha256(pin);
      rows = await sql`
        select id, salon_id, nombre, logo_url, servicios, productos, trabajadoras
        from salones
        where pin_hash = ${legacy} and pin_hash <> ''
        limit 1
      `;
      salon = rows[0];

      if (salon) {
        await sql`update salones set pin_hash_v2 = ${peppered} where id = ${salon.id}`;
      }
    }

    // Sin match de dueña: probar contra los PINs de trabajadoras (si algún
    // salón le dio acceso a alguna desde Configuración).
    let workerNombre = null;
    if (!salon) {
      rows = await sql`
        select s.id, s.salon_id, s.nombre, s.logo_url, s.servicios, s.productos, s.trabajadoras,
               t->>'nombre' as trabajadora_nombre
        from salones s, jsonb_array_elements(s.trabajadoras) t
        where t->>'pin_hash' = ${peppered}
        limit 1
      `;
      salon = rows[0];
      if (salon) workerNombre = salon.trabajadora_nombre;
    }

    if (!salon) {
      await sql`insert into login_attempts (ip, success) values (${ip}, false)`;
      return res.status(401).json({ error: 'PIN incorrecto' });
    }

    await sql`insert into login_attempts (ip, success) values (${ip}, true)`;

    const role = workerNombre ? 'trabajadora' : 'duena';
    const token = createSessionToken(salon.id, { role, worker: workerNombre });

    return res.status(200).json({
      success: true,
      token,
      salon_id: salon.salon_id,
      salon_nombre: salon.nombre,
      sheet_id: salon.id,
      logo_url: salon.logo_url || '',
      servicios: salon.servicios || [],
      productos: salon.productos || [],
      trabajadoras: sanitizeTrabajadoras(salon.trabajadoras),
      role,
      worker_nombre: workerNombre,
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al validar PIN' });
  }
};
