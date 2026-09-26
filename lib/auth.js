/**
 * Sesiones firmadas + hashing de PIN para las serverless functions.
 *
 * Antes, cualquier request con el uuid de un salón (expuesto sin auth por
 * /api/salones) podía leer/escribir sus datos: el PIN nunca se verificaba
 * en cada llamada, solo al entrar. Ahora el login emite un token firmado
 * (HMAC) con el id del salón + expiración, y cada endpoint lo exige y usa
 * ÚNICAMENTE el salon_id verificado del token para escopar sus consultas
 * — nunca el sheet_id que mande el cliente.
 */

const crypto = require('crypto');

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 horas

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Falta SESSION_SECRET en el entorno');
  return secret;
}

function getPinPepper() {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper) throw new Error('Falta PIN_PEPPER en el entorno');
  return pepper;
}

/**
 * Permisos extra que la dueña le da a una trabajadora desde Configuración.
 * Todos arrancan apagados. Se guardan en `salones.trabajadoras[].permisos`.
 *
 * - telefonos: ver y agregar el teléfono de las clientas en la Agenda y
 *   confirmar citas por WhatsApp. Nunca incluye la nota fija (alergias).
 */
const PERMISOS_TRABAJADORA = ['telefonos'];

function normalizarPermisos(permisos) {
  const limpios = {};
  for (const p of PERMISOS_TRABAJADORA) limpios[p] = permisos?.[p] === true;
  return limpios;
}

/**
 * Quita `pin_hash` de cada trabajadora antes de mandarla al cliente — el
 * hash no tiene ninguna razón para salir del servidor. Lo reemplaza por
 * `tiene_acceso` (booleano), lo único que le sirve al frontend (mostrar
 * "Tiene acceso" en Configuración), y agrega sus `permisos`. Usado por
 * /api/login y /api/config.
 */
function sanitizeTrabajadoras(trabajadoras) {
  return (trabajadoras || []).map((t) => ({
    nombre: t.nombre,
    tiene_acceso: !!t.pin_hash,
    permisos: normalizarPermisos(t.permisos),
  }));
}

/**
 * Permisos vigentes de una trabajadora, leídos de la base en cada llamada
 * (no del token): si la dueña se los quita, dejan de valer al momento, sin
 * esperar a que la sesión expire.
 */
async function permisosDeTrabajadora(sql, salonId, worker) {
  const [fila] = await sql`
    select t->'permisos' as permisos
    from salones s, jsonb_array_elements(s.trabajadoras) t
    where s.id = ${salonId} and t->>'nombre' = ${worker || ''}
    limit 1
  `;
  return normalizarPermisos(fila?.permisos);
}

/**
 * Firma un token de sesión para un salón (uuid de `salones.id`).
 * `role` es 'duena' (default) o 'trabajadora'; si es trabajadora, `worker`
 * es su nombre — así cada endpoint sabe, sin otra consulta, quién es y
 * qué puede ver sin tener que volver a resolverlo contra la base de datos.
 */
function createSessionToken(salonId, { role = 'duena', worker = null } = {}) {
  const payload = JSON.stringify({ sid: salonId, role, worker, exp: Date.now() + SESSION_DURATION_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/** Verifica un token de sesión. Devuelve el payload completo ({sid, role, worker}) o null si es inválido/expiró. */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
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

  if (!payload || typeof payload.sid !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;

  return payload;
}

function extractToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Exige una sesión válida (header `Authorization: Bearer <token>`).
 * Si falta o es inválida, ya responde el error y devuelve null — el
 * caller debe hacer `if (!salonId) return;`. Si es válida, devuelve el
 * salon_id verificado: es el ÚNICO valor que debe usarse para escopar
 * consultas (nunca el sheet_id que venga en query/body).
 *
 * No distingue rol: úsala en endpoints donde una trabajadora también debe
 * poder entrar (el propio endpoint filtra qué ve, con `getSessionRole`).
 * Para endpoints exclusivos de la dueña, usa `requireOwnerSession`.
 */
function requireSession(req, res) {
  try {
    const payload = verifySessionToken(extractToken(req));

    if (!payload) {
      res.status(401).json({ error: 'Sesión inválida o expirada' });
      return null;
    }

    return payload.sid;
  } catch (error) {
    console.error('Error validando sesión:', error);
    res.status(500).json({ error: 'Error de configuración del servidor' });
    return null;
  }
}

/**
 * Igual que `requireSession`, pero además rechaza (403) una sesión de
 * trabajadora. El rechazo es por `role === 'trabajadora'` explícito, no por
 * `!== 'duena'`, para que un token ya emitido antes de que existiera el
 * campo `role` (sin ese campo) se siga tratando como dueña.
 */
function requireOwnerSession(req, res) {
  try {
    const payload = verifySessionToken(extractToken(req));

    if (!payload) {
      res.status(401).json({ error: 'Sesión inválida o expirada' });
      return null;
    }
    if (payload.role === 'trabajadora') {
      res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      return null;
    }

    return payload.sid;
  } catch (error) {
    console.error('Error validando sesión:', error);
    res.status(500).json({ error: 'Error de configuración del servidor' });
    return null;
  }
}

/**
 * Rol y nombre (si aplica) de la sesión actual, sin responder nada por sí
 * sola — se usa DESPUÉS de que `requireSession` ya validó, en endpoints
 * donde el comportamiento se ramifica por rol en vez de bloquearse del
 * todo. Si el token no tiene `role` (sesiones emitidas antes de este
 * cambio), se trata como dueña.
 */
function getSessionRole(req) {
  const payload = verifySessionToken(extractToken(req));
  if (!payload || payload.role !== 'trabajadora') {
    return { role: 'duena', worker: null };
  }
  return { role: 'trabajadora', worker: payload.worker || null };
}

/** Hash legacy (sin pepper) — solo para verificar PINs creados antes de esta migración. */
function legacySha256(pin) {
  return crypto.createHash('sha256').update(String(pin), 'utf8').digest('hex');
}

/** Hash de PIN con pepper del servidor. Nunca se calcula en el cliente. */
function pepperedPinHash(pin) {
  return crypto.createHmac('sha256', getPinPepper()).update(String(pin), 'utf8').digest('hex');
}

/**
 * ¿Ya usa alguien este PIN? El login busca el PIN sin pedir salón, así que
 * dos PINs iguales (en cualquier salón, de dueña o de trabajadora) chocan:
 * el login entraría con el primero que encuentre.
 *
 * Revisa el hash con pepper y el legacy (salones que todavía no migran).
 * `excepto` ({ salonId, nombre }) excluye a esa trabajadora de ese salón,
 * para no rechazar un re-guardado de su mismo PIN.
 */
async function pinEnUso(sql, pin, excepto = {}) {
  const peppered = pepperedPinHash(pin);
  const legacy = legacySha256(pin);
  const [{ en_uso }] = await sql`
    select exists(
      select 1 from salones where pin_hash_v2 = ${peppered} or (pin_hash = ${legacy} and pin_hash <> '')
      union all
      select 1 from salones s, jsonb_array_elements(s.trabajadoras) t
      where t->>'pin_hash' = ${peppered}
        and not (s.id::text = ${excepto.salonId || ''} and t->>'nombre' = ${excepto.nombre || ''})
    ) as en_uso
  `;
  return en_uso;
}

module.exports = {
  PERMISOS_TRABAJADORA,
  normalizarPermisos,
  permisosDeTrabajadora,
  pinEnUso,
  createSessionToken,
  verifySessionToken,
  requireSession,
  requireOwnerSession,
  getSessionRole,
  legacySha256,
  pepperedPinHash,
  sanitizeTrabajadoras,
};
