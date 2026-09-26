/**
 * GET/POST/DELETE /api/push-subscribe
 *
 * GET    → { public_key } — la llave pública VAPID, para armar la
 *          suscripción en el navegador (PushManager.subscribe).
 * POST   { subscription: { endpoint, keys: { p256dh, auth } } } → { success }
 *          Guarda/actualiza la suscripción del dispositivo actual.
 * DELETE { endpoint } → { success }
 *          Da de baja ese dispositivo (usuaria desactivó notificaciones).
 *
 * Solo la dueña puede suscribirse — las notificaciones existentes
 * (recordatorio de citas de mañana, aviso de cita nueva de una
 * trabajadora) son ambas para ella, ninguna trabajadora las necesita hoy.
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession } = require('../lib/auth');
const { isNonEmptyString } = require('../lib/validate');

function isValidSubscription(sub) {
  return sub && isNonEmptyString(sub.endpoint, 2000) &&
    sub.keys && isNonEmptyString(sub.keys.p256dh, 500) && isNonEmptyString(sub.keys.auth, 500);
}

module.exports = async function handler(req, res) {
  const salonId = requireOwnerSession(req, res);
  if (!salonId) return;

  try {
    if (req.method === 'GET') {
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      if (!publicKey) {
        return res.status(500).json({ error: 'Notificaciones push no configuradas en el servidor' });
      }
      return res.status(200).json({ public_key: publicKey });
    }

    const sql = getSql();

    if (req.method === 'POST') {
      const { subscription } = req.body || {};
      if (!isValidSubscription(subscription)) {
        return res.status(400).json({ error: 'Suscripción inválida' });
      }

      await sql`
        insert into push_subscriptions (salon_id, endpoint, p256dh, auth)
        values (${salonId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
        on conflict (endpoint)
        do update set salon_id = excluded.salon_id, p256dh = excluded.p256dh, auth = excluded.auth
      `;

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { endpoint } = req.body || {};
      if (!isNonEmptyString(endpoint, 2000)) {
        return res.status(400).json({ error: 'Falta el endpoint' });
      }

      await sql`delete from push_subscriptions where salon_id = ${salonId} and endpoint = ${endpoint}`;
      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en push-subscribe:', error);
    res.status(500).json({ error: 'Error al procesar la suscripción' });
  }
};
