/**
 * Utilidades compartidas
 */

/**
 * Métodos de pago soportados, en el orden en que se muestran. Un solo
 * lugar para no repetir la lista (con emoji y label) en cada flujo que la
 * usa — antes vivía copiada en cita.js y gasto.js, y agregar/quitar un
 * método ahí significaba acordarse de tocar los dos.
 */
export const METODOS_PAGO = [
  { id: 'Efectivo', emoji: '💵', label: 'Efectivo' },
  { id: 'Tarjeta', emoji: '💳', label: 'Tarjeta' },
  { id: 'Transferencia', emoji: '📱', label: 'Transferencia' },
];

/**
 * Escapa texto para poder inyectarlo en HTML sin romper el markup.
 * Importante para las notas y los nombres, que son texto libre: un `<`, una
 * comilla o un `</textarea>` dentro del texto rompería la página.
 */
export function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Clave para identificar a una clienta (el nombre es texto libre).
 * "María", "maria" y "MARIA " son la misma persona.
 * OJO: duplicada en api/clientas.js (el back es CommonJS y el front ESM).
 * Si cambia una, cambiar la otra.
 */
export function normalizeNombre(nombre) {
  return String(nombre || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Formatea un número como moneda MXN: $1,500.00 */
export function formatMXN(amount) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Devuelve la fecha de hoy en formato YYYY-MM-DD */
export function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Devuelve la fecha de hoy formateada para mostrar: "24 de febrero de 2026" */
export function todayFormatted() {
  return new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Lunes a domingo de la semana que contiene hoy (las comisiones se pagan por semana, no por mes). */
export function currentWeekRange() {
  const now = new Date();
  const dow = now.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { desde: toISODate(monday), hasta: toISODate(sunday) };
}

/** "2026-09-07" + "2026-09-13" → "7 al 13 de septiembre" (o "29 de agosto al 4 de septiembre" si cruza de mes) */
export function formatRangoFecha(desdeISO, hastaISO) {
  const d1 = new Date(desdeISO + 'T12:00:00');
  const d2 = new Date(hastaISO + 'T12:00:00');
  const mesD1 = d1.toLocaleDateString('es-MX', { month: 'long' });
  const mesD2 = d2.toLocaleDateString('es-MX', { month: 'long' });
  if (mesD1 === mesD2) {
    return `${d1.getDate()} al ${d2.getDate()} de ${mesD2}`;
  }
  return `${d1.getDate()} de ${mesD1} al ${d2.getDate()} de ${mesD2}`;
}

/** Devuelve timestamp actual: "14:30:05" */
export function nowTimestamp() {
  return new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

let toastTimer = null;

/**
 * Muestra un toast de notificación.
 * `action` es opcional: { label, onClick } agrega un botón (ej. "Deshacer")
 * que cierra el toast y corre `onClick` al presionarlo.
 */
export function showToast(message, type = 'default', duration = 3000, action = null) {
  const toast = document.getElementById('toast');
  toast.className = 'toast';
  if (type !== 'default') {
    toast.classList.add(`toast-${type}`);
  }

  // Un check animado en los toasts de éxito — el pequeño "momento de logro"
  // al confirmar una cita/gasto/pago, en vez de solo texto plano.
  const icono = type === 'success'
    ? '<svg class="toast-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '';

  toast.innerHTML = `
    ${icono}
    <span class="toast-message"></span>
    ${action ? `<button type="button" class="toast-action">${escapeHTML(action.label)}</button>` : ''}
  `;
  toast.querySelector('.toast-message').textContent = message;
  if (action) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      clearTimeout(toastTimer);
      toast.classList.add('hidden');
      action.onClick();
    });
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

/** HTML de un estado de carga: un spinner chico + el texto, en vez de solo
 * texto plano — mismo look en todas las pantallas que cargan datos. */
export function loadingHTML(texto) {
  return `<div class="loading-inline"><span class="spinner-sm"></span><span>${texto}</span></div>`;
}

/** Muestra/oculta el loader global */
export function showLoader() {
  document.getElementById('loader').classList.remove('hidden');
}

export function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
}
