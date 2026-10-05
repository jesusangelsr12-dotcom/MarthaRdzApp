/**
 * Cliente HTTP para las serverless functions
 */

import { getToken, logout } from './auth.js';
import { showToast, hideLoader } from './utils.js';

const BASE_URL = '/api';

/**
 * Llamada genérica a la API.
 * @param {string} endpoint - Ruta sin /api/ (ej: "citas", "login")
 * @param {object} options - { method, body }
 * @returns {Promise<object>} JSON de respuesta
 */
async function fetchAPI(endpoint, options = {}) {
  const { method = 'GET', body } = options;

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = { method, headers };
  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}/${endpoint}`, config);

  // No toda respuesta es JSON: un 502/504 de Vercel llega como HTML. Se
  // lee como texto y se intenta parsear, para no perder el error real
  // detrás de un "Unexpected token <".
  const texto = await response.text();
  let data = null;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    data = null;
  }

  // Sesión vencida o inválida: el token se mandó y el servidor ya no lo
  // acepta. Sin esto la app seguía "en sesión" y cada pantalla mostraba
  // "Error al cargar…" sin salida. (Un 401 sin token, como un PIN
  // incorrecto en Login, no entra aquí.)
  if (response.status === 401 && token) {
    logout();
    hideLoader();
    showToast('Tu sesión expiró. Entra de nuevo con tu PIN', 'error', 4000);
    window.location.hash = '#login';
    throw new Error('Sesión expirada');
  }

  if (!response.ok) {
    throw new Error(data?.error || mensajePorEstado(response.status));
  }
  if (data === null) {
    throw new Error('Respuesta inesperada del servidor. Intenta de nuevo');
  }

  return data;
}

function mensajePorEstado(status) {
  if (status === 503) return 'Sin conexión a internet';
  if (status >= 500) return 'El servidor no respondió bien. Intenta de nuevo en un momento';
  return 'Error en la solicitud';
}

/** Validar PIN de 6 dígitos (busca automáticamente el salón) */
export function login(pin) {
  return fetchAPI('login', {
    method: 'POST',
    body: { pin },
  });
}

/** Obtener configuración del salón (servicios, etc.) */
export function getConfig(sheetId) {
  return fetchAPI(`config?sheet_id=${encodeURIComponent(sheetId)}`);
}

/** Actualizar configuración del salón (servicios, productos, trabajadoras) */
export function updateConfig(sheetId, servicios, productos, trabajadoras) {
  return fetchAPI('config', {
    method: 'POST',
    body: { sheet_id: sheetId, servicios, productos, trabajadoras },
  });
}

/** Obtener citas de hoy */
export function getCitas(sheetId, fecha) {
  return fetchAPI(`citas?sheet_id=${encodeURIComponent(sheetId)}&fecha=${fecha}`);
}

/** Anticipos que la Agenda vieja dejó registrados y que todavía no se
 * aplican a una cita: [{ id, clienta, fecha, monto }] */
export function getAnticiposPendientes(sheetId) {
  return fetchAPI(`citas?sheet_id=${encodeURIComponent(sheetId)}&anticipos=pendientes`);
}

/** Registrar nueva cita */
export function createCita(sheetId, cita) {
  return fetchAPI('citas', {
    method: 'POST',
    body: { sheet_id: sheetId, ...cita },
  });
}

/** Eliminar una cita */
export function deleteCita(sheetId, fecha, timestamp, clienta) {
  return fetchAPI('citas', {
    method: 'DELETE',
    body: { sheet_id: sheetId, fecha, timestamp, clienta },
  });
}

/** Deshacer la eliminación de una cita (ventana corta después de borrarla) */
export function restoreCita(sheetId, fecha, timestamp, clienta) {
  return fetchAPI('citas', {
    method: 'PATCH',
    body: { sheet_id: sheetId, fecha, timestamp, clienta, restore: true },
  });
}

/** Obtener gastos de hoy */
export function getGastos(sheetId, fecha) {
  return fetchAPI(`gastos?sheet_id=${encodeURIComponent(sheetId)}&fecha=${fecha}`);
}

/** Registrar nuevo gasto */
export function createGasto(sheetId, gasto) {
  return fetchAPI('gastos', {
    method: 'POST',
    body: { sheet_id: sheetId, ...gasto },
  });
}

/** Eliminar un gasto */
export function deleteGasto(sheetId, fecha, timestamp, descripcion) {
  return fetchAPI('gastos', {
    method: 'DELETE',
    body: { sheet_id: sheetId, fecha, timestamp, descripcion },
  });
}

/** Deshacer la eliminación de un gasto (ventana corta después de borrarlo) */
export function restoreGasto(sheetId, fecha, timestamp, descripcion) {
  return fetchAPI('gastos', {
    method: 'PATCH',
    body: { sheet_id: sheetId, fecha, timestamp, descripcion, restore: true },
  });
}

/** Obtener nombres únicos de clientas (+ sus notas fijas y teléfonos) */
export function getClientas(sheetId) {
  return fetchAPI(`clientas?sheet_id=${encodeURIComponent(sheetId)}`);
}

/** Historial completo agrupado por clienta (una sola llamada) */
export function getHistorial(sheetId) {
  return fetchAPI(`clientas?sheet_id=${encodeURIComponent(sheetId)}&historial=1`);
}

/** Editar la nota / fórmula de una cita ya registrada */
export function updateCitaNota(sheetId, { fecha, timestamp, clienta, nota }) {
  return fetchAPI('citas', {
    method: 'PATCH',
    body: { sheet_id: sheetId, fecha, timestamp, clienta, nota },
  });
}

/** Corregir los precios (y el anticipo) de una cita ya registrada. El
 * servidor recalcula el total y las comisiones; responde { success, total }. */
export function updateCitaPrecios(sheetId, { fecha, timestamp, clienta, items, anticipo }) {
  return fetchAPI('citas', {
    method: 'PATCH',
    body: { sheet_id: sheetId, fecha, timestamp, clienta, items, anticipo },
  });
}

/**
 * Guardar nota fija y/o teléfono de una clienta (alergias, preferencias,
 * celular para WhatsApp). Se manda el registro completo — quien llama debe
 * pasar ambos valores actuales, aunque solo haya cambiado uno.
 */
export function saveNotaFija(sheetId, clienta, notaFija, telefono = '') {
  return fetchAPI('clientas', {
    method: 'POST',
    body: { sheet_id: sheetId, clienta, nota_fija: notaFija, telefono },
  });
}

/** Obtener comisiones registradas en un rango de fechas */
export function getComisiones(sheetId, desde, hasta) {
  return fetchAPI(
    `comisiones?sheet_id=${encodeURIComponent(sheetId)}&desde=${desde}&hasta=${hasta}`
  );
}

/** Resumen del negocio (ingresos/gastos por día, top servicios/productos/clientas) */
export function getDashboard(sheetId, desde, hasta) {
  return fetchAPI(
    `dashboard?sheet_id=${encodeURIComponent(sheetId)}&desde=${desde}&hasta=${hasta}`
  );
}

/** Asignar/cambiar el PIN de acceso de una trabajadora (o quitárselo con remove: true) */
export function setTrabajadorPin(sheetId, { nombre, pin, remove }) {
  return fetchAPI('trabajador-pin', {
    method: 'POST',
    body: { sheet_id: sheetId, nombre, pin, remove },
  });
}

/** Prende o apaga un permiso de una trabajadora (ej. { <permiso>: true }).
 * Solo la dueña. Responde { success, permisos } con todos sus permisos. */
export function setPermisosTrabajadora(sheetId, nombre, permisos) {
  return fetchAPI('trabajador-pin', {
    method: 'POST',
    body: { sheet_id: sheetId, nombre, permisos },
  });
}

/** Llave pública VAPID, para armar la suscripción push en el navegador */
export function getPushPublicKey(sheetId) {
  return fetchAPI(`push-subscribe?sheet_id=${encodeURIComponent(sheetId)}`);
}

/** Guardar la suscripción push del dispositivo actual */
export function subscribePush(sheetId, subscription) {
  return fetchAPI('push-subscribe', {
    method: 'POST',
    body: { sheet_id: sheetId, subscription },
  });
}

/** Dar de baja la suscripción push del dispositivo actual */
export function unsubscribePush(sheetId, endpoint) {
  return fetchAPI('push-subscribe', {
    method: 'DELETE',
    body: { sheet_id: sheetId, endpoint },
  });
}

// Los 5 pasos de Face ID/Touch ID viven en un solo endpoint (/api/webauthn)
// para no pasarse del límite de Serverless Functions de Vercel Hobby —
// mode/action en el body dicen cuál de los 5 es.

/** Face ID/Touch ID: opciones para activar en este dispositivo (requiere sesión con PIN) */
export function getWebauthnRegisterOptions() {
  return fetchAPI('webauthn', { method: 'POST', body: { mode: 'register', action: 'options' } });
}

/** Face ID/Touch ID: confirmar el registro del dispositivo */
export function verifyWebauthnRegister(body) {
  return fetchAPI('webauthn', { method: 'POST', body: { mode: 'register', action: 'verify', ...body } });
}

/** Face ID/Touch ID: opciones para iniciar sesión (sin sesión previa) */
export function getWebauthnLoginOptions() {
  return fetchAPI('webauthn', { method: 'POST', body: { mode: 'login', action: 'options' } });
}

/** Face ID/Touch ID: confirmar el login — misma forma de respuesta que login(pin) */
export function verifyWebauthnLogin(body) {
  return fetchAPI('webauthn', { method: 'POST', body: { mode: 'login', action: 'verify', ...body } });
}

/** Dispositivos con Face ID/Touch ID activado (de la identidad en sesión) */
export function getWebauthnDevices() {
  return fetchAPI('webauthn');
}

/** Quitar Face ID/Touch ID de un dispositivo */
export function deleteWebauthnDevice(id) {
  return fetchAPI('webauthn', { method: 'DELETE', body: { id } });
}
