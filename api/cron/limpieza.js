/**
 * GET /api/cron/limpieza
 *
 * Disparado una vez al día por Vercel Cron (ver "crons" en vercel.json).
 * Limpia `login_attempts`: el rate limit solo mira los últimos 15 minutos,
 * así que las filas de más de 30 días ya no sirven y solo crecían.
 *
 * (Antes se llamaba reminder-citas y además mandaba el push de "citas de
 * mañana" de la Agenda; la Agenda se retiró en la v50 y solo quedó esto.)
 *
 * Protegido con CRON_SECRET: Vercel manda automáticamente
 * `Authorization: Bearer $CRON_SECRET` en cada invocación programada
 * cuando esa variable de entorno existe — sin este chequeo, cualquiera
 * que adivine la URL podría dispararlo a mano.
 */

const { getSql } = require('../../lib/db');

const DIAS_LOGIN_ATTEMPTS = 30;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  try {
    const sql = getSql();
    const [{ n }] = await sql`
      with borrados as (
        delete from login_attempts
        where attempted_at < now() - make_interval(days => ${DIAS_LOGIN_ATTEMPTS}::int)
        returning 1
      )
      select count(*)::int as n from borrados
    `;

    return res.status(200).json({ intentos_borrados: n });
  } catch (error) {
    console.error('Error en limpieza diaria:', error);
    return res.status(500).json({ error: 'Error en la limpieza diaria' });
  }
};
