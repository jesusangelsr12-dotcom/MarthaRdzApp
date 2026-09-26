/**
 * Pruebas de lib/auth.js: tokens de sesión firmados y hash de PIN.
 * Sin esto, un bug aquí (una firma que no verifica, un token que no
 * expira) pasaría desapercibido hasta que alguien lo explotara en producción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-session-secret';
process.env.PIN_PEPPER = 'test-pin-pepper';

const { createSessionToken, verifySessionToken, getSessionRole, legacySha256, pepperedPinHash } = require('../lib/auth');

test('un token recién creado verifica al mismo salon_id', () => {
  const token = createSessionToken('salon-123');
  assert.equal(verifySessionToken(token).sid, 'salon-123');
});

test('sin opciones, el token es de rol dueña (default)', () => {
  const token = createSessionToken('salon-123');
  const payload = verifySessionToken(token);
  assert.equal(payload.role, 'duena');
  assert.equal(payload.worker, null);
});

test('un token de trabajadora guarda su rol y su nombre', () => {
  const token = createSessionToken('salon-123', { role: 'trabajadora', worker: 'Aly' });
  const payload = verifySessionToken(token);
  assert.equal(payload.sid, 'salon-123');
  assert.equal(payload.role, 'trabajadora');
  assert.equal(payload.worker, 'Aly');
});

test('getSessionRole lee el rol de un token válido en el header Authorization', () => {
  const token = createSessionToken('salon-123', { role: 'trabajadora', worker: 'Aly' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  assert.deepEqual(getSessionRole(req), { role: 'trabajadora', worker: 'Aly' });
});

test('getSessionRole trata como dueña un token legacy (emitido antes de que existiera "role") o sin Authorization', () => {
  // Simula un token firmado antes de este cambio: payload sin `role` ni `worker`.
  const crypto = require('node:crypto');
  const payloadLegacy = Buffer.from(JSON.stringify({ sid: 'salon-123', exp: Date.now() + 60000 }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payloadLegacy).digest('base64url');
  const tokenLegacy = `${payloadLegacy}.${sig}`;

  assert.deepEqual(getSessionRole({ headers: { authorization: `Bearer ${tokenLegacy}` } }), { role: 'duena', worker: null });
  assert.deepEqual(getSessionRole({ headers: {} }), { role: 'duena', worker: null });
});

test('un token alterado (firma no coincide) se rechaza', () => {
  const token = createSessionToken('salon-123');
  const [payload] = token.split('.');
  const tokenAlterado = `${payload}.firmaInventada`;
  assert.equal(verifySessionToken(tokenAlterado), null);
});

test('un payload de otro salon con la firma de este token se rechaza', () => {
  const token = createSessionToken('salon-123');
  const [, sig] = token.split('.');
  const payloadFalso = Buffer.from(JSON.stringify({ sid: 'salon-999', exp: Date.now() + 1000 }), 'utf8').toString('base64url');
  assert.equal(verifySessionToken(`${payloadFalso}.${sig}`), null);
});

test('un token expirado se rechaza', () => {
  const payload = Buffer.from(JSON.stringify({ sid: 'salon-123', exp: Date.now() - 1000 }), 'utf8').toString('base64url');
  const crypto = require('node:crypto');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  assert.equal(verifySessionToken(`${payload}.${sig}`), null);
});

test('verifySessionToken no truena con entradas basura', () => {
  assert.equal(verifySessionToken(null), null);
  assert.equal(verifySessionToken(''), null);
  assert.equal(verifySessionToken('sin-punto'), null);
  assert.equal(verifySessionToken('a.b.c'), null);
});

test('pepperedPinHash es determinístico y distinto para PINs distintos', () => {
  assert.equal(pepperedPinHash('123456'), pepperedPinHash('123456'));
  assert.notEqual(pepperedPinHash('123456'), pepperedPinHash('654321'));
});

test('pepperedPinHash y legacySha256 producen esquemas distintos (el pepper sí cambia el hash)', () => {
  assert.notEqual(pepperedPinHash('123456'), legacySha256('123456'));
});
