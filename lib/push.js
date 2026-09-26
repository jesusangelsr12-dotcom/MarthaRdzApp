/**
 * Envío de notificaciones push (Web Push estándar — funciona en Android y en
 * iOS 16.4+ para la PWA instalada, sin necesidad de certificado APNs).
 *
 * Requiere VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT en el
 * entorno (generadas una sola vez con `npx web-push generate-vapid-keys`).
 */

const webpush = require('web-push');

let configured = false;

function ensureConfigured() {
  if (configured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT en el entorno');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/**
 * Manda un push a todos los dispositivos suscritos de un salón. Cada
 * dispositivo se manda por separado: si uno falla (celular apagado hace
 * semanas, etc.) no debe tumbar el envío a los demás.
 *
 * Una suscripción con 404/410 significa que el navegador la revocó
 * (desinstaló la app, borró datos del sitio) — se borra sola en vez de
 * seguir intentando mandarle para siempre.
 */
async function enviarPushSalon(sql, salonId, { title, body, url = '/' }) {
  ensureConfigured();

  const subs = await sql`
    select id, endpoint, p256dh, auth from push_subscriptions where salon_id = ${salonId}
  `;
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url });

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await sql`delete from push_subscriptions where id = ${sub.id}`;
      } else {
        console.error('Error enviando push:', error.message);
      }
    }
  }));
}

module.exports = { enviarPushSalon };
