/**
 * Face ID / Touch ID (WebAuthn) — helpers compartidos por los 4 endpoints
 * de registro/login. La verificación cripto (firma, attestation) la hace
 * @simplewebauthn/server; esto solo arma las opciones para el navegador y
 * firma/valida el "challenge" de cada ceremonia.
 *
 * Las funciones de la API son sin estado (serverless) y no hay tabla de
 * sesión: en vez de guardar el challenge en la base de datos, se manda al
 * cliente firmado con HMAC (mismo patrón que el token de sesión en
 * lib/auth.js) y el cliente lo regresa junto con la respuesta del
 * navegador — si alguien lo altera, la firma no cuadra.
 */

const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos — de sobra para completar Face ID/Touch ID
const RP_NAME = 'Martha Rdz Hair Artist';

function getSecret() {
  // Mismo secreto que firma el token de sesión — un HMAC más, no hace
  // falta una variable de entorno nueva solo para esto.
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Falta SESSION_SECRET en el entorno');
  return secret;
}

/** Dominio + origen a partir del request — así funciona igual en cualquier
 * deployment (producción, preview de esta rama) sin hardcodear nada. Las
 * credenciales quedan atadas a ese dominio exacto (regla del propio
 * WebAuthn): si cambias de dominio, hay que volver a activar Face ID. */
function getRpConfig(req) {
  const host = String(req.headers['host'] || '').split(':')[0];
  return { rpID: host, rpName: RP_NAME, origin: `https://${host}` };
}

/** Firma un challenge con datos de contexto (para registro, salonId/role/worker). */
function signChallenge(challenge, context = {}) {
  const payload = JSON.stringify({ challenge, ...context, exp: Date.now() + CHALLENGE_TTL_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/** Verifica y decodifica un challenge token. null si es inválido/expiró. */
function verifyChallenge(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || Date.now() > payload.exp) return null;
  return payload;
}

module.exports = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  getRpConfig,
  signChallenge,
  verifyChallenge,
};
