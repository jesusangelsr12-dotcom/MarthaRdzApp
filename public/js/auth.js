/**
 * Manejo de sesión — PIN auth con expiración de 8 horas
 */

const SESSION_KEY = 'jr_session';
const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 horas en ms

/** Expiración (ms) que firmó el servidor dentro del token, o null si no se
 * puede leer. El payload es base64url(JSON) y no es secreto: solo la firma
 * lo es, y esa la valida el servidor. */
function expiracionDelToken(token) {
  try {
    const payloadB64 = String(token || '').split('.')[0];
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Guarda la sesión en localStorage.
 * @param {object} salonData - { token, salon_id, salon_nombre, sheet_id, logo_url, servicios, … }
 *
 * La expiración local es la MISMA que la del token del servidor. Antes se
 * calculaba "ahora + 8 h" en cada guardado, así que guardar Configuración
 * alargaba la sesión local aunque el token ya estuviera por vencer: la app
 * creía seguir en sesión y cada pantalla fallaba con 401.
 */
export function saveSession(salonData) {
  const expToken = expiracionDelToken(salonData.token);
  const session = {
    ...salonData,
    created_at: salonData.created_at || Date.now(),
    expires_at: expToken || salonData.expires_at || Date.now() + SESSION_DURATION,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Obtiene la sesión actual o null si expiró / no existe */
export function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (Date.now() > session.expires_at) {
      logout();
      return null;
    }
    return session;
  } catch {
    logout();
    return null;
  }
}

/** Verifica si hay sesión válida */
export function isAuthenticated() {
  return getSession() !== null;
}

/**
 * Token firmado por el servidor (emitido en /api/login) que se manda en
 * cada llamada a la API — es lo único que el backend acepta como prueba de
 * sesión; el resto de los datos guardados aquí son solo para la UI.
 */
export function getToken() {
  return getSession()?.token || null;
}

/** Cierra sesión */
export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

/** true si la sesión actual es de una trabajadora (acceso limitado) */
export function isTrabajadora() {
  return getSession()?.role === 'trabajadora';
}

/** Nombre de la trabajadora en sesión, o null si es la dueña */
export function getWorkerName() {
  return getSession()?.worker_nombre || null;
}
