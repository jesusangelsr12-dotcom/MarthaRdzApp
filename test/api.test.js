/**
 * Pruebas de integración de api/: cada handler corre contra un Postgres
 * real (PGlite, ver test/helpers/db.js) con todas las migraciones aplicadas.
 * Cubren los cabos sueltos C1, C2, C3, C5/C6, C8 y C12 de docs/AppFlow.md
 * para que no vuelvan a aparecer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./helpers/db');
const { createSessionToken, pepperedPinHash, legacySha256, pinEnUso } = require('../lib/auth');
const { fechaMexico } = require('../lib/fecha');

async function salonDePrueba(sql, { nombre = 'Salón Prueba', salonId = 'salon_001', trabajadoras = [] } = {}) {
  const [s] = await sql`
    insert into salones (salon_id, nombre, pin_hash, pin_hash_v2, servicios, productos, trabajadoras)
    values (${salonId}, ${nombre}, '', ${pepperedPinHash('111111')}, '["Corte","Tinte"]'::jsonb, '["Shampoo"]'::jsonb,
            ${JSON.stringify(trabajadoras)}::jsonb)
    returning id
  `;
  return s.id;
}

const citaBase = (extra = {}) => ({
  fecha: '2026-09-26',
  timestamp: '14:30:05',
  clienta: 'María López',
  items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 800 }],
  total: 800,
  metodo_pago: 'Tarjeta',
  nota: '',
  ...extra,
});

async function agendarConAnticipo(t, token, anticipo = 200) {
  const r = await t.llamar('citas-agendadas', {
    method: 'POST', token,
    body: { clienta: 'María López', fecha: '2026-10-02', hora: '16:30', anticipo, anticipo_metodo_pago: anticipo > 0 ? 'Efectivo' : undefined, timestamp: '10:00:00' },
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('C2 · fechaMexico usa la fecha de Ciudad de México, no la de UTC', () => {
  // 26 sep 01:00 UTC = 25 sep 19:00 en México
  const ahora = new Date('2026-09-26T01:00:00Z');
  assert.equal(fechaMexico(0, ahora), '2026-09-25');
  assert.equal(fechaMexico(1, ahora), '2026-09-26');
  assert.equal(fechaMexico(-1, ahora), '2026-09-24');
  // Cambio de mes y de año
  assert.equal(fechaMexico(1, new Date('2026-09-30T18:00:00Z')), '2026-10-01');
  assert.equal(fechaMexico(1, new Date('2027-01-01T05:00:00Z')), '2027-01-01');
});

test('C2 · el anticipo se registra con la fecha de hoy en México', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token);
  const [fila] = await t.sql`select fecha::text as fecha from citas where agenda_id = ${agendaId}`;
  assert.equal(fila.fecha, fechaMexico());
  await t.cerrar();
});

test('C3 · cobrar una cita agendada: completada + cita + comisiones, y no se cobra dos veces', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 200);

  const cobro = citaBase({
    total: 600, agenda_id: agendaId, anticipo_aplicado: 200,
    comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 40, comision: 320 }],
  });
  const r1 = await t.llamar('citas', { method: 'POST', token, body: cobro });
  assert.equal(r1.statusCode, 201, JSON.stringify(r1.body));

  const [agenda] = await t.sql`select estado from citas_agendadas where id = ${agendaId}`;
  assert.equal(agenda.estado, 'completada');
  const citas = await t.sql`select total, anticipo_aplicado from citas where agenda_id = ${agendaId} and not (items @> '[{"tipo":"anticipo"}]'::jsonb)`;
  assert.equal(citas.length, 1);
  assert.equal(Number(citas[0].total), 600);
  const coms = await t.sql`select comision, fecha::text as fecha from comisiones`;
  assert.equal(coms.length, 1);
  assert.equal(Number(coms[0].comision), 320);
  assert.equal(coms[0].fecha, '2026-09-26');

  const r2 = await t.llamar('citas', { method: 'POST', token, body: { ...cobro, timestamp: '14:31:00' } });
  assert.equal(r2.statusCode, 400);
  const [{ n }] = await t.sql`select count(*)::int as n from citas`;
  assert.equal(n, 2, 'solo el anticipo y un cobro');
  const [{ c }] = await t.sql`select count(*)::int as c from comisiones`;
  assert.equal(c, 1, 'el segundo intento no deja comisiones sueltas');
  await t.cerrar();
});

test('C3 · si falla un paso del cobro, no queda nada a medias', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 0);
  // Fuerza que el insert de comisiones truene después de los otros dos pasos.
  await t.sql`alter table comisiones add constraint prueba_falla check (pct < 50)`;

  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({
      agenda_id: agendaId, anticipo_aplicado: 0,
      comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 60, comision: 480 }],
    }),
  });
  assert.equal(r.statusCode, 500);
  const [agenda] = await t.sql`select estado from citas_agendadas where id = ${agendaId}`;
  assert.equal(agenda.estado, 'pendiente', 'la cita agendada sigue pendiente para reintentar');
  const [{ n }] = await t.sql`select count(*)::int as n from citas`;
  assert.equal(n, 0);
  await t.cerrar();
});

test('C3 · una cita normal (sin agenda) se registra con sus comisiones; agenda_id mal formado es 400', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({ comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 30, comision: 240 }] }),
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const [{ c }] = await t.sql`select count(*)::int as c from comisiones`;
  assert.equal(c, 1);

  const malo = await t.llamar('citas', { method: 'POST', token, body: citaBase({ agenda_id: 'no-es-uuid', anticipo_aplicado: 0 }) });
  assert.equal(malo.statusCode, 400);
  await t.cerrar();
});

test('C3 · una trabajadora solo puede asignarse comisión a sí misma', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }, { nombre: 'Bety' }] });
  const token = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({ comisiones: [{ trabajadora: 'Bety', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 30, comision: 240 }] }),
  });
  assert.equal(r.statusCode, 400);
  await t.cerrar();
});

test('C1 · una cita agendada ya cobrada no se puede eliminar y su cobro sigue intacto', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 200);
  await t.llamar('citas', { method: 'POST', token, body: citaBase({ total: 600, agenda_id: agendaId, anticipo_aplicado: 200 }) });

  const r = await t.llamar('citas-agendadas', { method: 'DELETE', token, body: { id: agendaId } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /Ver Registros/);
  const vivas = await t.sql`select id from citas where agenda_id = ${agendaId} and deleted_at is null`;
  assert.equal(vivas.length, 2, 'anticipo y cobro siguen vivos');
  await t.cerrar();
});

test('C1 · eliminar una pendiente borra solo su anticipo, y Deshacer lo regresa', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 200);

  const del = await t.llamar('citas-agendadas', { method: 'DELETE', token, body: { id: agendaId } });
  assert.equal(del.statusCode, 200);
  const [borrada] = await t.sql`select deleted_at from citas where agenda_id = ${agendaId}`;
  assert.ok(borrada.deleted_at, 'el anticipo se borra con la cita agendada');

  const restore = await t.llamar('citas-agendadas', { method: 'PATCH', token, body: { id: agendaId, restore: true } });
  assert.equal(restore.statusCode, 200);
  const [viva] = await t.sql`select deleted_at from citas where agenda_id = ${agendaId}`;
  assert.equal(viva.deleted_at, null);
  await t.cerrar();
});

test('C1 · una trabajadora no puede eliminar citas agendadas', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const agendaId = await agendarConAnticipo(t, createSessionToken(salonId), 0);
  const token = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  const r = await t.llamar('citas-agendadas', { method: 'DELETE', token, body: { id: agendaId } });
  assert.equal(r.statusCode, 403);
  await t.cerrar();
});

test('C14 · la Agenda puede pedir las pendientes de días pasados', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  await t.sql`
    insert into citas_agendadas (salon_id, clienta, fecha, hora, estado) values
      (${salonId}, 'Vieja pendiente', '2026-09-01', '10:00', 'pendiente'),
      (${salonId}, 'Vieja cancelada', '2026-09-02', '10:00', 'cancelada'),
      (${salonId}, 'Futura', '2099-01-01', '10:00', 'pendiente')
  `;
  const r = await t.llamar('citas-agendadas', { token, query: { hasta: '2026-09-25', estado: 'pendiente' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.citas_agendadas.map((c) => c.clienta), ['Vieja pendiente']);
  await t.cerrar();
});

test('C5/C6 · pinEnUso detecta PINs de dueñas (nuevo y legacy) y de trabajadoras de cualquier salón', async () => {
  const t = await crearEntorno();
  const a = await salonDePrueba(t.sql, { salonId: 'salon_001', trabajadoras: [{ nombre: 'Aly', pin_hash: pepperedPinHash('222222') }] });
  await t.sql`insert into salones (salon_id, nombre, pin_hash) values ('salon_002', 'Legacy', ${legacySha256('333333')})`;

  assert.equal(await pinEnUso(t.sql, '111111'), true, 'PIN de dueña con pepper');
  assert.equal(await pinEnUso(t.sql, '333333'), true, 'PIN de dueña legacy');
  assert.equal(await pinEnUso(t.sql, '222222'), true, 'PIN de trabajadora');
  assert.equal(await pinEnUso(t.sql, '999999'), false);
  assert.equal(await pinEnUso(t.sql, '222222', { salonId: a, nombre: 'Aly' }), false, 'su propio PIN no cuenta');
  assert.equal(await pinEnUso(t.sql, '222222', { salonId: 'otro', nombre: 'Aly' }), true, 'otra Aly de otro salón sí cuenta');
  await t.cerrar();
});

test('C6 · asignar a una trabajadora un PIN que ya usa una dueña responde 409', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const r = await t.llamar('trabajador-pin', { method: 'POST', token, body: { nombre: 'Aly', pin: '111111' } });
  assert.equal(r.statusCode, 409);
  const ok = await t.llamar('trabajador-pin', { method: 'POST', token, body: { nombre: 'Aly', pin: '444444' } });
  assert.equal(ok.statusCode, 200);
  await t.cerrar();
});

async function credencial(sql, salonId, worker, credentialId) {
  await sql`
    insert into webauthn_credentials (salon_id, role, worker, credential_id, public_key)
    values (${salonId}, 'trabajadora', ${worker}, ${credentialId}, 'pk')
  `;
}

test('C8 · quitarle el acceso a una trabajadora borra su Face ID', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly', pin_hash: pepperedPinHash('222222') }, { nombre: 'Bety' }] });
  await credencial(t.sql, salonId, 'Aly', 'cred-aly');
  await credencial(t.sql, salonId, 'Bety', 'cred-bety');
  const token = createSessionToken(salonId);

  const r = await t.llamar('trabajador-pin', { method: 'POST', token, body: { nombre: 'Aly', remove: true } });
  assert.equal(r.statusCode, 200);
  const quedan = await t.sql`select worker from webauthn_credentials`;
  assert.deepEqual(quedan.map((c) => c.worker), ['Bety']);
  await t.cerrar();
});

test('C8 · borrar a una trabajadora en Configuración borra su Face ID (y conserva el PIN de las demás)', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }, { nombre: 'Bety', pin_hash: pepperedPinHash('555555') }] });
  await credencial(t.sql, salonId, 'Aly', 'cred-aly');
  await credencial(t.sql, salonId, 'Bety', 'cred-bety');
  const token = createSessionToken(salonId);

  const r = await t.llamar('config', { method: 'POST', token, body: { servicios: ['Corte'], productos: [], trabajadoras: [{ nombre: 'Bety' }] } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const quedan = await t.sql`select worker from webauthn_credentials`;
  assert.deepEqual(quedan.map((c) => c.worker), ['Bety']);
  const [salon] = await t.sql`select trabajadoras from salones where id = ${salonId}`;
  assert.equal(salon.trabajadoras[0].pin_hash, pepperedPinHash('555555'));
  await t.cerrar();
});

test('C12 · el cron diario borra intentos de login de más de 30 días', async () => {
  const t = await crearEntorno();
  delete process.env.CRON_SECRET;
  await t.sql`
    insert into login_attempts (ip, success, attempted_at) values
      ('1.1.1.1', false, now() - interval '40 days'),
      ('1.1.1.1', false, now() - interval '31 days'),
      ('1.1.1.1', false, now() - interval '2 days')
  `;
  const r = await t.llamar('cron/reminder-citas', { method: 'GET' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.intentos_borrados, 2);
  const [{ n }] = await t.sql`select count(*)::int as n from login_attempts`;
  assert.equal(n, 1);
  await t.cerrar();
});

test('Login con PIN de dueña y de trabajadora (humo)', async () => {
  const t = await crearEntorno();
  await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly', pin_hash: pepperedPinHash('222222') }] });
  const d = await t.llamar('login', { method: 'POST', body: { pin: '111111' } });
  assert.equal(d.statusCode, 200);
  assert.equal(d.body.role, 'duena');
  const w = await t.llamar('login', { method: 'POST', body: { pin: '222222' } });
  assert.equal(w.body.role, 'trabajadora');
  assert.equal(w.body.worker_nombre, 'Aly');
  assert.ok(!JSON.stringify(w.body).includes('pin_hash'), 'el hash nunca sale al cliente');
  const mal = await t.llamar('login', { method: 'POST', body: { pin: '000000' } });
  assert.equal(mal.statusCode, 401);
  await t.cerrar();
});
