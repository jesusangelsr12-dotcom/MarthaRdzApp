/**
 * GET /api/cron/reminder-citas
 *
 * Disparado una vez al día por Vercel Cron (ver "crons" en vercel.json).
 * Para cada salón con citas agendadas pendientes para MAÑANA, manda un
 * push a la dueña: "tienes N citas mañana, revisa confirmaciones" — así
 * le da tiempo de confirmarlas por WhatsApp (ver public/js/views/agenda.js)
 * antes del día de la cita.
 *
 * De paso, limpia `login_attempts`: el rate limit solo mira los últimos 15
 * minutos, así que las filas de más de 30 días ya no sirven y solo crecían.
 *
 * Protegido con CRON_SECRET: Vercel manda automáticamente
 * `Authorization: Bearer $CRON_SECRET` en cada invocación programada
 * cuando esa variable de entorno existe — sin este chequeo, cualquiera
 * que adivine la URL podría disparar el envío a mano.
 */

const { getSql } = require('../../lib/db');
const { enviarPushSalon } = require('../../lib/push');
const { fechaMexico } = require('../../lib/fecha');

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
    const manana = fechaMexico(1);

    const rows = await sql`
      select salon_id, count(*)::int as total
      from citas_agendadas
      where fecha = ${manana} and estado = 'pendiente' and deleted_at is null
      group by salon_id
    `;

    await Promise.all(rows.map((row) => {
      const mensaje = row.total === 1
        ? 'Tienes 1 cita mañana — revisa que esté confirmada'
        : `Tienes ${row.total} citas mañana — revisa que estén confirmadas`;
      return enviarPushSalon(sql, row.salon_id, {
        title: 'Citas de mañana',
        body: mensaje,
        url: '/#agenda',
      });
    }));

    // La limpieza no debe tumbar los recordatorios (ya enviados arriba).
    let intentosBorrados = 0;
    try {
      const [{ n }] = await sql`
        with borrados as (
          delete from login_attempts
          where attempted_at < now() - make_interval(days => ${DIAS_LOGIN_ATTEMPTS}::int)
          returning 1
        )
        select count(*)::int as n from borrados
      `;
      intentosBorrados = n;
    } catch (error) {
      console.error('Error limpiando login_attempts:', error.message);
    }

    return res.status(200).json({ salones_notificados: rows.length, intentos_borrados: intentosBorrados });
  } catch (error) {
    console.error('Error en reminder-citas:', error);
    return res.status(500).json({ error: 'Error al procesar recordatorios' });
  }
};
