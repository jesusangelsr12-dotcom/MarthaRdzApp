/**
 * Links de WhatsApp (click-to-chat, wa.me) — para compartir recibos.
 *
 * OJO — límite real de la plataforma, no de esta app: un link de wa.me solo
 * abre WhatsApp con el mensaje ya escrito; quien lo abre tiene que tocar
 * "Enviar" a mano. Mandar el mensaje solo, sin ese toque humano, requiere
 * la WhatsApp Business Platform (Cloud API) — cuenta de Meta Business,
 * número verificado y plantillas de mensaje pre-aprobadas, con un proveedor
 * como Twilio o 360dialog de por medio. Es un proyecto aparte, no algo que
 * se resuelva agregando código aquí.
 */

/** "4421234567" → "524421234567" (52 = México). null si no hay 10 dígitos. */
function toWhatsAppNumber(telefono) {
  const digits = String(telefono || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `52${digits}`;
}

/**
 * Arma el link de wa.me con el mensaje ya escrito (el usuario solo tiene
 * que tocar Enviar). Devuelve null si el teléfono no es válido.
 */
export function buildWhatsAppLink(telefono, mensaje) {
  const numero = toWhatsAppNumber(telefono);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

/** Abre WhatsApp (app si está instalada, WhatsApp Web si no) en una pestaña nueva. */
export function abrirWhatsApp(telefono, mensaje) {
  const link = buildWhatsAppLink(telefono, mensaje);
  if (!link) return false;
  window.open(link, '_blank', 'noopener');
  return true;
}

/**
 * Compartir un recibo/mensaje: en iOS/Android usa el share sheet nativo
 * (`navigator.share`) — ahí la usuaria elige WhatsApp, iMessage, Mail o lo
 * que tenga instalado, sin que la app tenga que adivinar cuál. En desktop
 * (donde `navigator.share` no existe) cae a wa.me directo, si hay teléfono
 * guardado. Devuelve false solo si no hay ninguna forma de compartir
 * disponible (desktop sin teléfono en el registro de la clienta).
 */
export async function compartirTexto(mensaje, telefono) {
  if (navigator.share) {
    try {
      await navigator.share({ text: mensaje });
    } catch {
      // Cancelado por la usuaria o compartido sin confirmación final —
      // ninguno de los dos es un error real que haya que reportar.
    }
    return true;
  }
  return abrirWhatsApp(telefono, mensaje);
}
