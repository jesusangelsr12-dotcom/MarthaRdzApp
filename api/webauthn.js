/**
 * /api/webauthn — Face ID/Touch ID, todo en un solo endpoint.
 *
 * Vercel Hobby limita a 12 Serverless Functions por deployment — juntar
 * las 4 ceremonias de WebAuthn (registro/login, cada una en dos pasos:
 * opciones + verificación) más el listado/borrado de dispositivos en un
 * solo archivo, en vez de uno por paso, deja espacio para el resto de la
 * API sin acercarse al límite.
 *
 * GET    → { dispositivos } — requiere sesión (los de la identidad actual:
 *          dueña, o esta trabajadora en particular).
 * DELETE { id } → quitar un dispositivo — requiere sesión.
 * POST   { mode: 'register', action: 'options' } → requiere sesión.
 *        Face ID/Touch ID se activa DESDE dentro de la app, nunca antes
 *        de haber entrado una vez con el PIN.
 * POST   { mode: 'register', action: 'verify', response, challenge_token, device_label } → requiere sesión.
 * POST   { mode: 'login', action: 'options' } → SIN sesión (es el reemplazo del PIN).
 *        Sin allowCredentials: el navegador muestra cualquier credencial
 *        de este dominio que tenga guardada — login "sin nombre de usuario".
 * POST   { mode: 'login', action: 'verify', response, challenge_token } → SIN sesión.
 *        Misma forma de respuesta que POST /api/login, para que el
 *        frontend guarde la sesión igual sin importar cómo entró.
 *        Una credencial de trabajadora solo entra si ella sigue en el
 *        catálogo con PIN (acceso vigente); si no, se borra y responde 401.
 */

const crypto = require('crypto');
const { getSql } = require('../lib/db');
const { requireSession, getSessionRole, createSessionToken, sanitizeTrabajadoras } = require('../lib/auth');
const { isNonEmptyString } = require('../lib/validate');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  getRpConfig,
  signChallenge,
  verifyChallenge,
} = require('../lib/webauthn');

async function handleRegisterOptions(req, res, salonId, role, worker) {
  const sql = getSql();
  const [salon] = await sql`select nombre from salones where id = ${salonId}`;
  const nombreSalon = salon?.nombre || 'Mi Salón';

  const existentes = role === 'trabajadora'
    ? await sql`select credential_id from webauthn_credentials where salon_id = ${salonId} and role = 'trabajadora' and worker = ${worker}`
    : await sql`select credential_id from webauthn_credentials where salon_id = ${salonId} and role = 'duena'`;

  const { rpID, rpName } = getRpConfig(req);
  const displayName = role === 'trabajadora' ? `${nombreSalon} — ${worker}` : `${nombreSalon} — Dueña`;

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: displayName,
    userDisplayName: displayName,
    userID: crypto.randomBytes(32),
    attestationType: 'none',
    excludeCredentials: existentes.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });

  const challengeToken = signChallenge(options.challenge, { salonId, role, worker });
  return res.status(200).json({ options, challenge_token: challengeToken });
}

async function handleRegisterVerify(req, res, salonId, role, worker) {
  const { response, challenge_token, device_label } = req.body || {};

  const challengeData = verifyChallenge(challenge_token);
  if (!challengeData || challengeData.salonId !== salonId || challengeData.role !== role || challengeData.worker !== worker) {
    return res.status(400).json({ error: 'La solicitud expiró o no es válida — intenta de nuevo' });
  }
  if (!response || typeof response !== 'object') {
    return res.status(400).json({ error: 'Respuesta inválida del dispositivo' });
  }

  const { rpID, origin } = getRpConfig(req);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'No se pudo verificar el dispositivo' });
  }

  const { credential } = verification.registrationInfo;
  const label = isNonEmptyString(device_label, 60) ? device_label.trim() : '';
  const sql = getSql();

  await sql`
    insert into webauthn_credentials (salon_id, role, worker, credential_id, public_key, counter, device_label)
    values (
      ${salonId}, ${role}, ${worker},
      ${credential.id}, ${Buffer.from(credential.publicKey).toString('base64url')}, ${credential.counter},
      ${label}
    )
  `;

  return res.status(200).json({ success: true });
}

async function handleLoginOptions(req, res) {
  const { rpID } = getRpConfig(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const challengeToken = signChallenge(options.challenge, {});
  return res.status(200).json({ options, challenge_token: challengeToken });
}

async function handleLoginVerify(req, res) {
  const { response, challenge_token } = req.body || {};

  const challengeData = verifyChallenge(challenge_token);
  if (!challengeData) {
    return res.status(400).json({ error: 'La solicitud expiró — intenta de nuevo' });
  }
  if (!response || typeof response.id !== 'string') {
    return res.status(400).json({ error: 'Respuesta inválida del dispositivo' });
  }

  const sql = getSql();
  const [cred] = await sql`
    select id, salon_id, role, worker, credential_id, public_key, counter
    from webauthn_credentials
    where credential_id = ${response.id}
  `;
  if (!cred) {
    return res.status(401).json({ error: 'Este dispositivo no tiene Face ID/Touch ID activado — usa tu PIN' });
  }

  const { rpID, origin } = getRpConfig(req);

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: cred.credential_id,
      publicKey: Buffer.from(cred.public_key, 'base64url'),
      counter: Number(cred.counter),
    },
  });

  if (!verification.verified) {
    return res.status(401).json({ error: 'No se pudo verificar Face ID/Touch ID' });
  }

  await sql`update webauthn_credentials set counter = ${verification.authenticationInfo.newCounter} where id = ${cred.id}`;

  const [salon] = await sql`
    select id, salon_id, nombre, logo_url, servicios, productos, trabajadoras
    from salones where id = ${cred.salon_id}
  `;
  if (!salon) {
    return res.status(401).json({ error: 'El salón ya no existe' });
  }

  // Quitarle el acceso a una trabajadora (o borrarla del catálogo) debe
  // cortar también su Face ID. El mensaje contiene "no tiene Face ID" a
  // propósito: así login.js borra la bandera local y deja de ofrecerlo.
  if (cred.role === 'trabajadora') {
    const vigente = (salon.trabajadoras || []).some((t) => t.nombre === cred.worker && t.pin_hash);
    if (!vigente) {
      await sql`delete from webauthn_credentials where id = ${cred.id}`;
      return res.status(401).json({ error: 'Esta cuenta ya no tiene Face ID/Touch ID activo. Usa tu PIN' });
    }
  }

  const token = createSessionToken(salon.id, { role: cred.role, worker: cred.worker });

  return res.status(200).json({
    success: true,
    token,
    salon_id: salon.salon_id,
    salon_nombre: salon.nombre,
    sheet_id: salon.id,
    logo_url: salon.logo_url || '',
    servicios: salon.servicios || [],
    productos: salon.productos || [],
    trabajadoras: sanitizeTrabajadoras(salon.trabajadoras),
    role: cred.role,
    worker_nombre: cred.worker,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { mode, action } = req.body || {};

      if (mode === 'login') {
        if (action === 'options') return await handleLoginOptions(req, res);
        if (action === 'verify') return await handleLoginVerify(req, res);
        return res.status(400).json({ error: 'action inválido' });
      }

      if (mode === 'register') {
        const salonId = requireSession(req, res);
        if (!salonId) return;
        const { role, worker } = getSessionRole(req);

        if (action === 'options') return await handleRegisterOptions(req, res, salonId, role, worker);
        if (action === 'verify') return await handleRegisterVerify(req, res, salonId, role, worker);
        return res.status(400).json({ error: 'action inválido' });
      }

      return res.status(400).json({ error: 'mode inválido' });
    }

    // GET/DELETE: dispositivos ya activados — siempre requieren sesión.
    const salonId = requireSession(req, res);
    if (!salonId) return;
    const { role, worker } = getSessionRole(req);
    const sql = getSql();

    if (req.method === 'GET') {
      const rows = role === 'trabajadora'
        ? await sql`select id, credential_id, device_label, created_at from webauthn_credentials where salon_id = ${salonId} and role = 'trabajadora' and worker = ${worker} order by created_at desc`
        : await sql`select id, credential_id, device_label, created_at from webauthn_credentials where salon_id = ${salonId} and role = 'duena' order by created_at desc`;

      return res.status(200).json({ dispositivos: rows });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!isNonEmptyString(id, 100)) {
        return res.status(400).json({ error: 'Falta el dispositivo a quitar' });
      }

      if (role === 'trabajadora') {
        await sql`delete from webauthn_credentials where id = ${id} and salon_id = ${salonId} and role = 'trabajadora' and worker = ${worker}`;
      } else {
        await sql`delete from webauthn_credentials where id = ${id} and salon_id = ${salonId} and role = 'duena'`;
      }

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en webauthn:', error);
    res.status(500).json({ error: 'Error al procesar Face ID/Touch ID' });
  }
};
