/**
 * Face ID / Touch ID (WebAuthn) — llamadas al navegador.
 *
 * Los navegadores más nuevos (Safari 18+, Chrome 122+) traen métodos que
 * hacen la conversión base64url↔ArrayBuffer solos
 * (`PublicKeyCredential.parseCreationOptionsFromJSON`, `credential.toJSON()`).
 * Donde no existan (versiones de iOS más viejas que igual soportan Face
 * ID/Touch ID por WebAuthn, solo no esos atajos), se hace la conversión a
 * mano — mismo resultado, sin depender de una librería externa (el CSP de
 * la app no permite cargar scripts de un CDN, todo tiene que ser propio).
 */

const KEY_BIOMETRIA_ACTIVA = 'jr_biometria_activa';
const KEY_BIOMETRIA_CREDENTIAL_ID = 'jr_biometria_credential_id';

function base64urlToBuffer(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function opcionesCreacionDesdeJSON(options) {
  if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') {
    return PublicKeyCredential.parseCreationOptionsFromJSON(options);
  }
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: base64urlToBuffer(c.id) })),
  };
}

function opcionesLoginDesdeJSON(options) {
  if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') {
    return PublicKeyCredential.parseRequestOptionsFromJSON(options);
  }
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: base64urlToBuffer(c.id) })),
  };
}

/** Credencial de navigator.credentials.create() → JSON para el servidor. */
function credencialRegistroAJSON(credential) {
  if (typeof credential.toJSON === 'function') return credential.toJSON();

  const r = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: bufferToBase64url(r.clientDataJSON),
      attestationObject: bufferToBase64url(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : undefined,
    },
  };
}

/** Credencial de navigator.credentials.get() → JSON para el servidor. */
function credencialLoginAJSON(credential) {
  if (typeof credential.toJSON === 'function') return credential.toJSON();

  const r = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: bufferToBase64url(r.clientDataJSON),
      authenticatorData: bufferToBase64url(r.authenticatorData),
      signature: bufferToBase64url(r.signature),
      userHandle: r.userHandle ? bufferToBase64url(r.userHandle) : undefined,
    },
  };
}

/** true si este dispositivo puede usar Face ID/Touch ID/Windows Hello (no solo WebAuthn en general). */
export async function biometriaDisponible() {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** true si ESTE dispositivo ya activó Face ID/Touch ID antes (para decidir qué botón mostrar en Login sin llamar al servidor). */
export function biometriaActivaEnEsteDispositivo() {
  try {
    return localStorage.getItem(KEY_BIOMETRIA_ACTIVA) === '1';
  } catch {
    return false;
  }
}

function marcarBiometriaActiva(credentialId) {
  try {
    localStorage.setItem(KEY_BIOMETRIA_ACTIVA, '1');
    if (credentialId) localStorage.setItem(KEY_BIOMETRIA_CREDENTIAL_ID, credentialId);
  } catch { /* ignore */ }
}

export function olvidarBiometriaEnEsteDispositivo() {
  try {
    localStorage.removeItem(KEY_BIOMETRIA_ACTIVA);
    localStorage.removeItem(KEY_BIOMETRIA_CREDENTIAL_ID);
  } catch { /* ignore */ }
}

/** El credential_id que este dispositivo registró (o null) — para que
 * Configuración pueda marcar "(este dispositivo)" en la lista y, si la
 * usuaria lo quita desde ahí, limpiar también la bandera local. */
export function credentialIdDeEsteDispositivo() {
  try {
    return localStorage.getItem(KEY_BIOMETRIA_CREDENTIAL_ID);
  } catch {
    return null;
  }
}

/** Nombre genérico del dispositivo, solo para mostrarlo en la lista de Configuración. */
function nombreDispositivo() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'Este dispositivo';
}

/**
 * Ceremonia completa de registro: pide las opciones al servidor, activa
 * Face ID/Touch ID del sistema operativo, y manda la respuesta a
 * verificar. Lanza un Error con mensaje legible si algo falla.
 */
export async function activarBiometria({ getOptions, verify }) {
  const { options, challenge_token } = await getOptions();
  const publicKey = opcionesCreacionDesdeJSON(options);

  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey });
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      throw new Error('Cancelado');
    }
    throw new Error('No se pudo activar Face ID/Touch ID en este dispositivo');
  }

  await verify({
    response: credencialRegistroAJSON(credential),
    challenge_token,
    device_label: nombreDispositivo(),
  });
  marcarBiometriaActiva(credential.id);
}

/**
 * Ceremonia completa de login: pide las opciones al servidor (sin sesión
 * todavía), activa Face ID/Touch ID, y manda la respuesta a verificar.
 * Devuelve lo que responda `verify` (la sesión, igual que /api/login).
 */
export async function iniciarSesionConBiometria({ getOptions, verify }) {
  const { options, challenge_token } = await getOptions();
  const publicKey = opcionesLoginDesdeJSON(options);

  let credential;
  try {
    credential = await navigator.credentials.get({ publicKey });
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      throw new Error('Cancelado');
    }
    throw new Error('No se pudo verificar Face ID/Touch ID');
  }

  return verify({
    response: credencialLoginAJSON(credential),
    challenge_token,
  });
}
