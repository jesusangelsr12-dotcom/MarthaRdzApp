/**
 * GET /api/cron/limpieza[?tarea=respaldo]
 *
 * Tareas diarias de Vercel Cron (ver "crons" en vercel.json; Ciudad de
 * México es UTC−6 todo el año). Viven en una sola función por el límite de
 * 12 funciones del plan Hobby.
 *
 *   sin tarea (00:00 UTC = 18:00 México)
 *     · Limpia `login_attempts`: el rate limit solo mira los últimos 15
 *       minutos, así que las filas de más de 30 días ya no sirven y solo
 *       crecían.
 *   tarea=respaldo (09:00 UTC = 3:00 México)
 *     · Exporta la base completa a la carpeta «Martha Rdz - Base de Datos»
 *       de Google Drive (lib/respaldo.js). Sin RESPALDO_DRIVE_URL/CLAVE, o
 *       con DEMO=1, no hace nada. Si falla responde 502 y queda anotado en
 *       `respaldos` (la dueña lo ve en Configuración → Respaldo).
 *
 * (Antes se llamaba reminder-citas y además mandaba el push de "citas de
 * mañana" de la Agenda; la Agenda se retiró en la v50.)
 *
 * Protegido con CRON_SECRET: Vercel manda automáticamente
 * `Authorization: Bearer $CRON_SECRET` en cada invocación programada
 * cuando esa variable de entorno existe — sin este chequeo, cualquiera
 * que adivine la URL podría dispararlo a mano. El respaldo exige que
 * exista: sin ella no corre (exporta toda la base y escribe en Drive).
 */

const crypto = require('crypto');
const { getSql } = require('../../lib/db');
const respaldo = require('../../lib/respaldo');

const DIAS_LOGIN_ATTEMPTS = 30;

function autorizado(req) {
  const recibido = Buffer.from(String(req.headers['authorization'] || ''));
  const esperado = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
}

async function limpiarIntentos(sql) {
  const [{ n }] = await sql`
    with borrados as (
      delete from login_attempts
      where attempted_at < now() - make_interval(days => ${DIAS_LOGIN_ATTEMPTS}::int)
      returning 1
    )
    select count(*)::int as n from borrados
  `;
  return { intentos_borrados: n };
}

module.exports = async function handler(req, res) {
  const tarea = req.query?.tarea || 'limpieza';
  if (tarea !== 'limpieza' && tarea !== 'respaldo') return res.status(400).json({ error: 'Tarea desconocida' });

  if (tarea === 'respaldo' && !process.env.CRON_SECRET) {
    return res.status(503).json({ error: 'Falta CRON_SECRET en el servidor' });
  }
  if (process.env.CRON_SECRET && !autorizado(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const sql = getSql();
    if (tarea === 'limpieza') return res.status(200).json(await limpiarIntentos(sql));

    if (!respaldo.configurado()) return res.status(200).json({ respaldo: 'sin_configurar' });
    const r = await respaldo.respaldar(sql, { origen: 'cron' });
    return res.status(r.ok ? 200 : 502).json({
      respaldo: r.ok ? 'ok' : 'error', archivo: r.archivo, bytes: r.bytes, filas: r.filas, error: r.error || undefined,
    });
  } catch (error) {
    console.error(`Error en la tarea diaria (${tarea}):`, error);
    return res.status(500).json({ error: tarea === 'respaldo' ? 'Error en el respaldo diario' : 'Error en la limpieza diaria' });
  }
};
