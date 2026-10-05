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

// --- Permiso "Teléfonos de clientas" de una trabajadora (v49) ---

async function salonConClienta(t) {
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly', pin_hash: pepperedPinHash('222222') }] });
  await t.sql`
    insert into clientas (salon_id, clienta, clienta_normalizada, nota_fija, telefono)
    values (${salonId}, 'María López', 'maria lopez', 'Alergia al amoniaco', '8110000000')
  `;
  return {
    salonId,
    duena: createSessionToken(salonId),
    aly: createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' }),
  };
}

test('Permisos · sin permiso, la trabajadora no ve teléfonos ni puede guardarlos', async () => {
  const t = await crearEntorno();
  const { aly } = await salonConClienta(t);
  const g = await t.llamar('clientas', { token: aly });
  assert.equal(g.statusCode, 200);
  assert.deepEqual(g.body.telefonos, {});
  assert.deepEqual(g.body.notas_fijas, {});
  assert.equal(g.body.permiso_telefonos, false);
  const p = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'María López', nota_fija: '', telefono: '8119999999' } });
  assert.equal(p.statusCode, 403);
  await t.cerrar();
});

test('Permisos · con permiso ve y guarda teléfonos, pero nunca la nota fija', async () => {
  const t = await crearEntorno();
  const { duena, aly } = await salonConClienta(t);
  const dar = await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos: { telefonos: true } } });
  assert.equal(dar.statusCode, 200, JSON.stringify(dar.body));
  assert.deepEqual(dar.body.permisos, { telefonos: true });

  const g = await t.llamar('clientas', { token: aly });
  assert.equal(g.body.permiso_telefonos, true);
  assert.equal(g.body.telefonos['maria lopez'], '8110000000');
  assert.deepEqual(g.body.notas_fijas, {}, 'la nota fija sigue oculta');

  // Aunque mande una nota vacía, no borra la de la dueña ni cambia el nombre
  const p = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'maria lopez', nota_fija: '', telefono: '8119999999' } });
  assert.equal(p.statusCode, 200, JSON.stringify(p.body));
  const [c] = await t.sql`select clienta, nota_fija, telefono from clientas where clienta_normalizada = 'maria lopez'`;
  assert.deepEqual(c, { clienta: 'María López', nota_fija: 'Alergia al amoniaco', telefono: '8119999999' });

  // Clienta nueva: se crea solo con su teléfono
  const n = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'Ana Ruiz', telefono: '8117777777' } });
  assert.equal(n.statusCode, 200);
  // Borrar el teléfono no le toca
  const vacio = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'Ana Ruiz', telefono: '' } });
  assert.equal(vacio.statusCode, 400);
  // El historial sigue siendo solo de la dueña
  const h = await t.llamar('clientas', { token: aly, query: { historial: '1' } });
  assert.equal(h.statusCode, 403);
  await t.cerrar();
});

test('Permisos · quitarlo corta el acceso al momento, sin cerrar sesión', async () => {
  const t = await crearEntorno();
  const { duena, aly } = await salonConClienta(t);
  await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos: { telefonos: true } } });
  await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos: { telefonos: false } } });
  const g = await t.llamar('clientas', { token: aly });
  assert.deepEqual(g.body.telefonos, {});
  const p = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'María López', telefono: '8119999999' } });
  assert.equal(p.statusCode, 403);
  await t.cerrar();
});

test('Permisos · solo la dueña los cambia y solo acepta permisos conocidos', async () => {
  const t = await crearEntorno();
  const { duena, aly } = await salonConClienta(t);
  const w = await t.llamar('trabajador-pin', { method: 'POST', token: aly, body: { nombre: 'Aly', permisos: { telefonos: true } } });
  assert.equal(w.statusCode, 403);
  for (const permisos of [{ telefonos: 'si' }, { dinero: true }, [], null]) {
    const r = await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos } });
    assert.equal(r.statusCode, 400, JSON.stringify(permisos));
  }
  const x = await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Nadie', permisos: { telefonos: true } } });
  assert.equal(x.statusCode, 404);
  await t.cerrar();
});

test('Permisos · guardar el catálogo conserva PIN y permisos, y no acepta un pin_hash del cliente', async () => {
  const t = await crearEntorno();
  const { salonId, duena } = await salonConClienta(t);
  await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos: { telefonos: true } } });
  const r = await t.llamar('config', {
    method: 'POST', token: duena,
    body: { servicios: ['Corte'], productos: [], trabajadoras: [{ nombre: 'Aly' }, { nombre: 'Bea', pin_hash: 'inyectado', permisos: { telefonos: true } }] },
  });
  assert.equal(r.statusCode, 200);
  const [s] = await t.sql`select trabajadoras from salones where id = ${salonId}`;
  assert.deepEqual(s.trabajadoras, [
    { nombre: 'Aly', pin_hash: pepperedPinHash('222222'), permisos: { telefonos: true } },
    { nombre: 'Bea' },
  ]);
  const g = await t.llamar('config', { token: duena });
  assert.deepEqual(g.body.trabajadoras, [
    { nombre: 'Aly', tiene_acceso: true, permisos: { telefonos: true } },
    { nombre: 'Bea', tiene_acceso: false, permisos: { telefonos: false } },
  ]);
  await t.cerrar();
});

// --- Corregir el anticipo desde la Agenda y el cobro desde Ver Registros (v50) ---

const filasAnticipo = (sql, agendaId) => sql`
  select total, metodo_pago, items, fecha::text as fecha, deleted_at
  from citas where agenda_id = ${agendaId} and items @> '[{"tipo":"anticipo"}]'::jsonb
`;

test('Anticipo · corregirlo cambia la cita agendada y su ingreso juntos, en el mismo día', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 200);
  await t.sql`update citas set fecha = '2026-09-01' where agenda_id = ${agendaId}`;

  const r = await t.llamar('citas-agendadas', {
    method: 'PATCH', token,
    body: { id: agendaId, anticipo: 350, anticipo_metodo_pago: 'Transferencia', timestamp: '11:00:00', nota: 'Trae foto' },
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const [agenda] = await t.sql`select anticipo, anticipo_metodo_pago, nota, deposito_cita_id from citas_agendadas where id = ${agendaId}`;
  assert.equal(Number(agenda.anticipo), 350);
  assert.equal(agenda.anticipo_metodo_pago, 'Transferencia');
  assert.equal(agenda.nota, 'Trae foto');
  const filas = await filasAnticipo(t.sql, agendaId);
  assert.equal(filas.length, 1, 'se corrige la misma fila, no se duplica');
  assert.equal(Number(filas[0].total), 350);
  assert.equal(Number(filas[0].items[0].costo), 350);
  assert.equal(filas[0].metodo_pago, 'Transferencia');
  assert.equal(filas[0].fecha, '2026-09-01', 'se queda en el día en que se recibió');
  await t.cerrar();
});

test('Anticipo · de $0 a algo se registra hoy; a $0 se quita y Deshacer eliminar no lo revive', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 0);

  const sinMetodo = await t.llamar('citas-agendadas', { method: 'PATCH', token, body: { id: agendaId, anticipo: 150, timestamp: '11:00:00' } });
  assert.equal(sinMetodo.statusCode, 400);

  const poner = await t.llamar('citas-agendadas', {
    method: 'PATCH', token, body: { id: agendaId, anticipo: 150, anticipo_metodo_pago: 'Efectivo', timestamp: '11:00:00' },
  });
  assert.equal(poner.statusCode, 200, JSON.stringify(poner.body));
  let filas = await filasAnticipo(t.sql, agendaId);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, fechaMexico());
  assert.equal(filas[0].items[0].nombre, 'Anticipo — María López');
  const [conDeposito] = await t.sql`select deposito_cita_id from citas_agendadas where id = ${agendaId}`;
  assert.ok(conDeposito.deposito_cita_id);

  const quitar = await t.llamar('citas-agendadas', { method: 'PATCH', token, body: { id: agendaId, anticipo: 0 } });
  assert.equal(quitar.statusCode, 200, JSON.stringify(quitar.body));
  filas = await filasAnticipo(t.sql, agendaId);
  assert.equal(filas.length, 0, 'la fila se suelta de la cita');
  const [{ vivas }] = await t.sql`select count(*)::int as vivas from citas where deleted_at is null`;
  assert.equal(vivas, 0, 'el ingreso del anticipo ya no cuenta');
  const [agenda] = await t.sql`select anticipo, anticipo_metodo_pago, deposito_cita_id from citas_agendadas where id = ${agendaId}`;
  assert.deepEqual([Number(agenda.anticipo), agenda.anticipo_metodo_pago, agenda.deposito_cita_id], [0, null, null]);

  await t.llamar('citas-agendadas', { method: 'DELETE', token, body: { id: agendaId } });
  await t.llamar('citas-agendadas', { method: 'PATCH', token, body: { id: agendaId, restore: true } });
  const [{ revividas }] = await t.sql`select count(*)::int as revividas from citas where deleted_at is null`;
  assert.equal(revividas, 0);
  await t.cerrar();
});

test('Anticipo · no se corrige en una cita ya cobrada ni lo hace una trabajadora', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 200);

  const aly = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  const w = await t.llamar('citas-agendadas', { method: 'PATCH', token: aly, body: { id: agendaId, anticipo: 0 } });
  assert.equal(w.statusCode, 403);

  await t.llamar('citas', { method: 'POST', token, body: citaBase({ total: 600, agenda_id: agendaId, anticipo_aplicado: 200 }) });
  const r = await t.llamar('citas-agendadas', { method: 'PATCH', token, body: { id: agendaId, anticipo: 0 } });
  assert.equal(r.statusCode, 404);
  const filas = await filasAnticipo(t.sql, agendaId);
  assert.equal(filas.length, 1);
  assert.equal(Number(filas[0].total), 200, 'el anticipo cobrado sigue igual');
  await t.cerrar();
});

test('Cobro · corregir precios recalcula total, anticipo aplicado y comisiones', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await agendarConAnticipo(t, token, 500);
  // Precio menor que el anticipo: se aplicó topado a 300
  await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({
      items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 300 }], total: 0, agenda_id: agendaId, anticipo_aplicado: 300,
      comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 300, pct: 40, comision: 120 }],
    }),
  });

  const g = await t.llamar('citas', { token, query: { fecha: '2026-09-26' } });
  const cobroG = g.body.citas.find((c) => c.items[0].tipo === 'servicio');
  assert.equal(cobroG.agenda_id, agendaId, 'Ver Registros recibe el vínculo con la Agenda');
  assert.equal(cobroG.anticipo_agenda, 500, 'y el anticipo completo, para mostrar el total al corregir');

  const r = await t.llamar('citas', {
    method: 'PATCH', token,
    body: { fecha: '2026-09-26', timestamp: '14:30:05', clienta: 'María López', items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 900 }], metodo_pago: 'Efectivo' },
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, 400);
  const [cobro] = await t.sql`select total, anticipo_aplicado, metodo_pago, items from citas where agenda_id = ${agendaId} and not (items @> '[{"tipo":"anticipo"}]'::jsonb)`;
  assert.equal(Number(cobro.total), 400, '900 − anticipo completo de 500');
  assert.equal(Number(cobro.anticipo_aplicado), 500);
  assert.equal(cobro.metodo_pago, 'Efectivo');
  assert.equal(Number(cobro.items[0].costo), 900);
  const [com] = await t.sql`select costo, comision from comisiones`;
  assert.equal(Number(com.costo), 900);
  assert.equal(Number(com.comision), 360);
  await t.cerrar();
});

test('Cobro · solo cambian precios: ni items distintos, ni anticipos, ni trabajadoras', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  await t.llamar('citas', { method: 'POST', token, body: citaBase() });
  const id = { fecha: '2026-09-26', timestamp: '14:30:05', clienta: 'María López' };

  const otroItem = await t.llamar('citas', { method: 'PATCH', token, body: { ...id, items: [{ tipo: 'servicio', nombre: 'Corte', costo: 900 }], metodo_pago: 'Efectivo' } });
  assert.equal(otroItem.statusCode, 400);
  assert.match(otroItem.body.error, /precios/);
  const sinMetodo = await t.llamar('citas', { method: 'PATCH', token, body: { ...id, items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 900 }] } });
  assert.equal(sinMetodo.statusCode, 400);
  const noExiste = await t.llamar('citas', { method: 'PATCH', token, body: { ...id, clienta: 'Nadie', items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 900 }], metodo_pago: 'Efectivo' } });
  assert.equal(noExiste.statusCode, 404);
  const aly = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  const w = await t.llamar('citas', { method: 'PATCH', token: aly, body: { ...id, items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 900 }], metodo_pago: 'Efectivo' } });
  assert.equal(w.statusCode, 403);

  const agendaId = await agendarConAnticipo(t, token, 200);
  const [dep] = await t.sql`select fecha::text as fecha, timestamp, clienta from citas where agenda_id = ${agendaId}`;
  const anticipo = await t.llamar('citas', { method: 'PATCH', token, body: { ...dep, items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 1 }], metodo_pago: 'Efectivo' } });
  assert.equal(anticipo.statusCode, 400);
  assert.match(anticipo.body.error, /Agenda/);

  const [sigue] = await t.sql`select total from citas where timestamp = '14:30:05'`;
  assert.equal(Number(sigue.total), 800);
  await t.cerrar();
});

// --- Eliminar en Ver Registros el cobro de una cita agendada (v50, C15) ---

async function cobroDeAgenda(t, token, anticipo = 200) {
  const agendaId = await agendarConAnticipo(t, token, anticipo);
  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({
      total: 800 - anticipo, agenda_id: agendaId, anticipo_aplicado: anticipo,
      comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 40, comision: 320 }],
    }),
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  return agendaId;
}
const idCobro = { fecha: '2026-09-26', timestamp: '14:30:05', clienta: 'María López' };
const estadoAgenda = async (sql, id) => (await sql`select estado, deleted_at from citas_agendadas where id = ${id}`)[0];
const vivas = async (sql) => (await sql`select count(*)::int as n from citas where deleted_at is null`)[0].n;
const comisionesVivas = async (sql) => (await sql`select count(*)::int as n from comisiones where deleted_at is null`)[0].n;

test('C15 · borrar solo el cobro: el anticipo se queda y la cita vuelve a pendiente; Deshacer lo regresa', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await cobroDeAgenda(t, token);

  const g = await t.llamar('citas', { token, query: { fecha: '2026-09-26' } });
  assert.equal(g.body.citas[0].anticipo_registrado, 200, 'Registros sabe que hay anticipo que preguntar');

  const del = await t.llamar('citas', { method: 'DELETE', token, body: idCobro });
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  assert.equal(await vivas(t.sql), 1, 'solo queda el anticipo');
  assert.equal(await comisionesVivas(t.sql), 0);
  let agenda = await estadoAgenda(t.sql, agendaId);
  assert.deepEqual([agenda.estado, agenda.deleted_at], ['pendiente', null], 'se puede volver a cobrar');

  const undo = await t.llamar('citas', { method: 'PATCH', token, body: { ...idCobro, restore: true } });
  assert.equal(undo.statusCode, 200, JSON.stringify(undo.body));
  assert.equal(await vivas(t.sql), 2);
  assert.equal(await comisionesVivas(t.sql), 1);
  agenda = await estadoAgenda(t.sql, agendaId);
  assert.equal(agenda.estado, 'completada');
  await t.cerrar();
});

test('C15 · borrar cobro y anticipo: se va todo, también la cita agendada; Deshacer regresa todo', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await cobroDeAgenda(t, token);
  // Otro anticipo borrado antes (de otra corrección) no debe revivir con Deshacer
  await t.sql`
    insert into citas (salon_id, fecha, timestamp, clienta, items, total, metodo_pago, agenda_id, deleted_at)
    values (${salonId}, '2026-09-01', '09:00:00', 'María López', '[{"tipo":"anticipo","nombre":"Anticipo — María López","costo":50}]'::jsonb, 50, 'Efectivo', ${agendaId}, now() - interval '1 day')
  `;

  const malo = await t.llamar('citas', { method: 'DELETE', token, body: { ...idCobro, con_anticipo: 'si' } });
  assert.equal(malo.statusCode, 400);

  const del = await t.llamar('citas', { method: 'DELETE', token, body: { ...idCobro, con_anticipo: true } });
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  assert.equal(del.body.anticipos, 1);
  assert.equal(await vivas(t.sql), 0, 'ni cobro ni anticipo');
  assert.equal(await comisionesVivas(t.sql), 0);
  assert.ok((await estadoAgenda(t.sql, agendaId)).deleted_at, 'la cita agendada también se borra');

  const undo = await t.llamar('citas', { method: 'PATCH', token, body: { ...idCobro, restore: true } });
  assert.equal(undo.statusCode, 200, JSON.stringify(undo.body));
  assert.equal(await vivas(t.sql), 2, 'cobro y su anticipo, no el viejo');
  assert.equal(await comisionesVivas(t.sql), 1);
  const agenda = await estadoAgenda(t.sql, agendaId);
  assert.deepEqual([agenda.estado, agenda.deleted_at], ['completada', null]);
  await t.cerrar();
});

test('C15 · Deshacer no aplica si la cita agendada ya se volvió a cobrar; una cita normal se borra como siempre', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const agendaId = await cobroDeAgenda(t, token);
  await t.llamar('citas', { method: 'DELETE', token, body: idCobro });
  const otraVez = await t.llamar('citas', {
    method: 'POST', token, body: citaBase({ timestamp: '15:00:00', total: 600, agenda_id: agendaId, anticipo_aplicado: 200 }),
  });
  assert.equal(otraVez.statusCode, 201, 'la cita pendiente se puede cobrar de nuevo');
  const undo = await t.llamar('citas', { method: 'PATCH', token, body: { ...idCobro, restore: true } });
  assert.equal(undo.statusCode, 409);
  const [{ cobros }] = await t.sql`select count(*)::int as cobros from citas where agenda_id = ${agendaId} and deleted_at is null and not (items @> '[{"tipo":"anticipo"}]'::jsonb)`;
  assert.equal(cobros, 1, 'nunca dos cobros de la misma cita');

  // Cita normal: borrar y deshacer sin tocar la Agenda
  const normal = { ...idCobro, timestamp: '18:00:00', clienta: 'Ana Ruiz' };
  await t.llamar('citas', { method: 'POST', token, body: citaBase(normal) });
  assert.equal((await t.llamar('citas', { method: 'DELETE', token, body: normal })).statusCode, 200);
  assert.equal((await t.llamar('citas', { method: 'PATCH', token, body: { ...normal, restore: true } })).statusCode, 200);

  // Borrar la fila del anticipo sola sigue igual que antes (no toca la cita agendada)
  const [dep] = await t.sql`select fecha::text as fecha, timestamp, clienta from citas where agenda_id = ${agendaId} and items @> '[{"tipo":"anticipo"}]'::jsonb`;
  assert.equal((await t.llamar('citas', { method: 'DELETE', token, body: { ...dep, con_anticipo: true } })).statusCode, 200);
  assert.equal((await estadoAgenda(t.sql, agendaId)).estado, 'completada');
  await t.cerrar();
});
