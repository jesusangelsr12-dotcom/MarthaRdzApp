/**
 * Pruebas de integración de api/: cada handler corre contra un Postgres
 * real (PGlite, ver test/helpers/db.js) con todas las migraciones aplicadas.
 * Cubren los cabos sueltos C2, C3, C5/C6, C8 y C12 de docs/AppFlow.md
 * para que no vuelvan a aparecer, y el anticipo dentro de la cita (v50).
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

test('C3 · una cita normal se registra con sus comisiones', async () => {
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
  const [cita] = await t.sql`select total, anticipo, anticipo_origen_id from citas`;
  assert.equal(Number(cita.total), 800);
  assert.equal(Number(cita.anticipo), 0, 'sin anticipo, queda en 0');
  assert.equal(cita.anticipo_origen_id, null);
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

test('C12 · la limpieza diaria borra intentos de login de más de 30 días', async () => {
  const t = await crearEntorno();
  delete process.env.CRON_SECRET;
  await t.sql`
    insert into login_attempts (ip, success, attempted_at) values
      ('1.1.1.1', false, now() - interval '40 days'),
      ('1.1.1.1', false, now() - interval '31 days'),
      ('1.1.1.1', false, now() - interval '2 days')
  `;
  const r = await t.llamar('cron/limpieza', { method: 'GET' });
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

// --- Trabajadora: teléfonos y permisos (el permiso "Teléfonos de clientas"
// de la v49 se retiró con la Agenda en la v50) ---

async function salonConClienta(t, { permisos } = {}) {
  const aly = { nombre: 'Aly', pin_hash: pepperedPinHash('222222'), ...(permisos ? { permisos } : {}) };
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [aly] });
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

test('Trabajadora · no ve teléfonos ni notas fijas, ni puede guardarlos', async () => {
  const t = await crearEntorno();
  const { aly } = await salonConClienta(t);
  const g = await t.llamar('clientas', { token: aly });
  assert.equal(g.statusCode, 200);
  assert.deepEqual(g.body.clientas, ['María López'], 'el nombre sí, para el autocomplete');
  assert.deepEqual(g.body.telefonos, {});
  assert.deepEqual(g.body.notas_fijas, {});
  const p = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'María López', nota_fija: '', telefono: '8119999999' } });
  assert.equal(p.statusCode, 403);
  const h = await t.llamar('clientas', { token: aly, query: { historial: '1' } });
  assert.equal(h.statusCode, 403);
  await t.cerrar();
});

test('Trabajadora · un permiso "telefonos" que quedó guardado ya no le da acceso (y no se borra)', async () => {
  const t = await crearEntorno();
  const { salonId, aly, duena } = await salonConClienta(t, { permisos: { telefonos: true } });
  const g = await t.llamar('clientas', { token: aly });
  assert.deepEqual(g.body.telefonos, {});
  const p = await t.llamar('clientas', { method: 'POST', token: aly, body: { clienta: 'María López', telefono: '8119999999' } });
  assert.equal(p.statusCode, 403);

  // Guardar el catálogo conserva lo guardado tal cual, sin exponerlo
  const r = await t.llamar('config', { method: 'POST', token: duena, body: { servicios: ['Corte'], productos: [], trabajadoras: [{ nombre: 'Aly' }] } });
  assert.equal(r.statusCode, 200);
  const [s] = await t.sql`select trabajadoras from salones where id = ${salonId}`;
  assert.deepEqual(s.trabajadoras[0].permisos, { telefonos: true });
  const c = await t.llamar('config', { token: duena });
  assert.deepEqual(c.body.trabajadoras, [{ nombre: 'Aly', tiene_acceso: true, permisos: {} }]);
  await t.cerrar();
});

test('Permisos · solo la dueña los cambia y no acepta permisos que no existen', async () => {
  const t = await crearEntorno();
  const { duena, aly } = await salonConClienta(t);
  const w = await t.llamar('trabajador-pin', { method: 'POST', token: aly, body: { nombre: 'Aly', permisos: {} } });
  assert.equal(w.statusCode, 403);
  for (const permisos of [{ telefonos: true }, { dinero: true }, [], null]) {
    const r = await t.llamar('trabajador-pin', { method: 'POST', token: duena, body: { nombre: 'Aly', permisos } });
    assert.equal(r.statusCode, 400, JSON.stringify(permisos));
  }
  await t.cerrar();
});

test('Config · guardar el catálogo conserva el PIN y no acepta un pin_hash del cliente', async () => {
  const t = await crearEntorno();
  const { salonId, duena } = await salonConClienta(t);
  const r = await t.llamar('config', {
    method: 'POST', token: duena,
    body: { servicios: ['Corte'], productos: [], trabajadoras: [{ nombre: 'Aly' }, { nombre: 'Bea', pin_hash: 'inyectado', permisos: { telefonos: true } }] },
  });
  assert.equal(r.statusCode, 200);
  const [s] = await t.sql`select trabajadoras from salones where id = ${salonId}`;
  assert.deepEqual(s.trabajadoras, [
    { nombre: 'Aly', pin_hash: pepperedPinHash('222222') },
    { nombre: 'Bea' },
  ]);
  await t.cerrar();
});

// --- Anticipo dentro de la cita (v50) ---

/** Fila de solo-anticipo como las que dejó la Agenda vieja. */
async function anticipoViejo(sql, salonId, { clienta = 'María López', monto = 250, fecha = '2026-09-27' } = {}) {
  const items = JSON.stringify([{ tipo: 'anticipo', nombre: `Anticipo — ${clienta}`, costo: monto }]);
  const [fila] = await sql`
    insert into citas (salon_id, fecha, timestamp, clienta, items, total, metodo_pago, nota)
    values (${salonId}, ${fecha}, '23:15:59', ${clienta}, ${items}::jsonb, ${monto}, 'Transferencia', 'Anticipo de cita agendada')
    returning id
  `;
  return fila.id;
}

async function ingresos(t, token, desde, hasta) {
  const r = await t.llamar('dashboard', { token, query: { desde, hasta } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return r.body.resumen;
}

test('Anticipo · va dentro del total: 2500 con 500 de anticipo cuenta 2500 y la comisión sale de 2500', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({
      items: [{ tipo: 'servicio', nombre: 'Tinte', costo: 2500 }], total: 2500, anticipo: 500,
      comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 2500, pct: 10, comision: 250 }],
    }),
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));

  const resumen = await ingresos(t, token, '2026-09-26', '2026-09-26');
  assert.equal(resumen.ingresos, 2500);
  assert.equal(resumen.comisiones, 250);
  assert.equal(resumen.num_citas, 1);

  const g = await t.llamar('citas', { token, query: { fecha: '2026-09-26' } });
  assert.equal(g.body.citas[0].total, 2500);
  assert.equal(g.body.citas[0].anticipo, 500);
  await t.cerrar();
});

test('Anticipo · no puede ser mayor que el total ni negativo', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  for (const anticipo of [801, -1, 'mucho']) {
    const r = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo }) });
    assert.equal(r.statusCode, 400, String(anticipo));
  }
  const igual = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo: 800 }) });
  assert.equal(igual.statusCode, 201, 'pagado completo por adelantado sí se vale');
  // La base también lo cuida, aunque alguien se brinque la API
  await assert.rejects(t.sql`update citas set anticipo = 900`);
  await t.cerrar();
});

test('Anticipo viejo · la trabajadora ve los pendientes y al aplicarlo se mueve al día de la cita sin contarse doble', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const duena = createSessionToken(salonId);
  const aly = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  const origenId = await anticipoViejo(t.sql, salonId);

  const lista = await t.llamar('citas', { token: aly, query: { anticipos: 'pendientes' } });
  assert.equal(lista.statusCode, 200);
  assert.deepEqual(lista.body.anticipos, [{ id: origenId, clienta: 'María López', fecha: '2026-09-27', monto: 250 }]);

  const antes = await ingresos(t, duena, '2026-09-01', '2026-10-31');
  assert.equal(antes.ingresos, 250);

  const r = await t.llamar('citas', {
    method: 'POST', token: aly,
    body: citaBase({ fecha: '2026-10-02', total: 800, anticipo: 250, anticipo_origen_id: origenId }),
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));

  const despues = await ingresos(t, duena, '2026-09-01', '2026-10-31');
  assert.equal(despues.ingresos, 800, '250 del anticipo + 550 del resto, una sola vez');
  assert.equal((await ingresos(t, duena, '2026-09-27', '2026-09-27')).ingresos, 0, 'el 27-sep ya no lo cuenta');
  assert.equal((await ingresos(t, duena, '2026-10-02', '2026-10-02')).ingresos, 800);

  const [origen] = await t.sql`select deleted_at from citas where id = ${origenId}`;
  assert.ok(origen.deleted_at, 'la fila vieja se oculta, no se borra');
  const vacia = await t.llamar('citas', { token: aly, query: { anticipos: 'pendientes' } });
  assert.deepEqual(vacia.body.anticipos, []);

  // El mismo anticipo no se puede aplicar dos veces
  const otra = await t.llamar('citas', {
    method: 'POST', token: duena,
    body: citaBase({ fecha: '2026-10-03', timestamp: '11:00:00', total: 800, anticipo: 250, anticipo_origen_id: origenId }),
  });
  assert.equal(otra.statusCode, 409);
  const [{ n }] = await t.sql`select count(*)::int as n from citas where deleted_at is null`;
  assert.equal(n, 1);
  await t.cerrar();
});

test('Anticipo viejo · el monto debe coincidir y debe ser una fila de anticipo de este salón', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const otroSalon = await salonDePrueba(t.sql, { salonId: 'salon_002' });
  const token = createSessionToken(salonId);
  const origenId = await anticipoViejo(t.sql, salonId);
  const ajeno = await anticipoViejo(t.sql, otroSalon);

  const monto = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo: 300, anticipo_origen_id: origenId }) });
  assert.equal(monto.statusCode, 409, 'monto distinto');
  const otro = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo: 250, anticipo_origen_id: ajeno }) });
  assert.equal(otro.statusCode, 409, 'anticipo de otro salón');
  const sinMonto = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo_origen_id: origenId }) });
  assert.equal(sinMonto.statusCode, 400);
  const malo = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo: 250, anticipo_origen_id: 'no-es-uuid' }) });
  assert.equal(malo.statusCode, 400);

  // Una cita normal tampoco sirve de "anticipo de origen"
  await t.llamar('citas', { method: 'POST', token, body: citaBase({ timestamp: '09:00:00', total: 250, items: [{ tipo: 'servicio', nombre: 'Corte', costo: 250 }] }) });
  const [normal] = await t.sql`select id from citas where timestamp = '09:00:00'`;
  const noAnticipo = await t.llamar('citas', { method: 'POST', token, body: citaBase({ anticipo: 250, anticipo_origen_id: normal.id }) });
  assert.equal(noAnticipo.statusCode, 409);

  const [{ vivas }] = await t.sql`select count(*)::int as vivas from citas where id in (${origenId}, ${ajeno}) and deleted_at is null`;
  assert.equal(vivas, 2, 'ningún anticipo se tocó');
  await t.cerrar();
});

test('Anticipo viejo · si falla un paso del registro, el anticipo sigue pendiente y no queda nada a medias', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql, { trabajadoras: [{ nombre: 'Aly' }] });
  const token = createSessionToken(salonId);
  const origenId = await anticipoViejo(t.sql, salonId);
  // Fuerza que el insert de comisiones truene después de los otros dos pasos.
  await t.sql`alter table comisiones add constraint prueba_falla check (pct < 50)`;

  const r = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({
      anticipo: 250, anticipo_origen_id: origenId,
      comisiones: [{ trabajadora: 'Aly', item: 'Tinte', tipo: 'servicio', costo: 800, pct: 60, comision: 480 }],
    }),
  });
  assert.equal(r.statusCode, 500);
  const [origen] = await t.sql`select deleted_at from citas where id = ${origenId}`;
  assert.equal(origen.deleted_at, null, 'el anticipo sigue pendiente para reintentar');
  const [{ n }] = await t.sql`select count(*)::int as n from citas`;
  assert.equal(n, 1, 'solo el anticipo viejo');
  await t.cerrar();
});

test('Anticipo viejo · eliminar la cita lo regresa a pendiente y Deshacer lo vuelve a aplicar', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const origenId = await anticipoViejo(t.sql, salonId);
  const cita = citaBase({ fecha: '2026-10-02', total: 800, anticipo: 250, anticipo_origen_id: origenId });
  await t.llamar('citas', { method: 'POST', token, body: cita });
  const id = { fecha: cita.fecha, timestamp: cita.timestamp, clienta: cita.clienta };

  const del = await t.llamar('citas', { method: 'DELETE', token, body: id });
  assert.equal(del.statusCode, 200);
  assert.equal((await ingresos(t, token, '2026-09-01', '2026-10-31')).ingresos, 250, 'el anticipo sigue contando en su día');
  const pend = await t.llamar('citas', { token, query: { anticipos: 'pendientes' } });
  assert.equal(pend.body.anticipos.length, 1);

  const restore = await t.llamar('citas', { method: 'PATCH', token, body: { ...id, restore: true } });
  assert.equal(restore.statusCode, 200, JSON.stringify(restore.body));
  assert.equal((await ingresos(t, token, '2026-09-01', '2026-10-31')).ingresos, 800);
  const pend2 = await t.llamar('citas', { token, query: { anticipos: 'pendientes' } });
  assert.equal(pend2.body.anticipos.length, 0);
  await t.cerrar();
});

test('Anticipo viejo · Deshacer no lo cuenta doble si ya se aplicó a otra cita', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const token = createSessionToken(salonId);
  const origenId = await anticipoViejo(t.sql, salonId);
  const primera = citaBase({ fecha: '2026-10-02', total: 800, anticipo: 250, anticipo_origen_id: origenId });
  await t.llamar('citas', { method: 'POST', token, body: primera });
  const id = { fecha: primera.fecha, timestamp: primera.timestamp, clienta: primera.clienta };
  await t.llamar('citas', { method: 'DELETE', token, body: id });

  const segunda = await t.llamar('citas', {
    method: 'POST', token,
    body: citaBase({ fecha: '2026-10-03', timestamp: '12:00:00', total: 800, anticipo: 250, anticipo_origen_id: origenId }),
  });
  assert.equal(segunda.statusCode, 201);

  const restore = await t.llamar('citas', { method: 'PATCH', token, body: { ...id, restore: true } });
  assert.equal(restore.statusCode, 409);
  assert.equal((await ingresos(t, token, '2026-09-01', '2026-10-31')).ingresos, 800, 'solo la segunda cuenta');
  await t.cerrar();
});

test('Anticipo · consulta de anticipos con un valor desconocido es 400', async () => {
  const t = await crearEntorno();
  const salonId = await salonDePrueba(t.sql);
  const r = await t.llamar('citas', { token: createSessionToken(salonId), query: { anticipos: 'todos' } });
  assert.equal(r.statusCode, 400);
  await t.cerrar();
});
