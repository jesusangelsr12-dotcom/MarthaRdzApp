/**
 * Respaldo diario a Google Drive (lib/respaldo.js, scripts/respaldo-drive.gs):
 *  - exportar → restaurar en una base vacía deja cada tabla idéntica
 *    (fechas, jsonb, montos, bigint), con el ciclo citas.agenda_id ↔
 *    citas_agendadas.deposito_cita_id y la autorreferencia
 *    citas.anticipo_origen_id cargados en dos pasos.
 *  - restaurar nunca pisa una base con datos ni lee un archivo ajeno.
 *  - respaldar manda el .json.gz con clave y huella, anota cada intento
 *    (bien o mal) y nunca lanza.
 *  - el cron y Configuración → Respaldo: solo la dueña; sin configurar 409;
 *    con DEMO=1 no hace nada; la URL y la clave nunca salen.
 *  - el Apps Script guarda, reemplaza el del mismo día, deja 30 días + el
 *    día 1 de cada mes, no toca archivos ajenos y avisa si no llegó.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { crearEntorno } = require('./helpers/db');
const { createSessionToken, pepperedPinHash } = require('../lib/auth');
const respaldo = require('../lib/respaldo');

const URL_SCRIPT = 'https://script.google.com/macros/s/xyz/exec';
const CLAVE = 'clave-larga-de-prueba-0123456789abcdef';
const CARPETA_URL = 'https://drive.google.com/drive/folders/carpeta-martha';

const ENV = ['RESPALDO_DRIVE_URL', 'RESPALDO_DRIVE_CLAVE', 'DEMO', 'CRON_SECRET'];
const guardado = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const fetchOriginal = global.fetch;
function restaurarEnv() {
  for (const [k, v] of Object.entries(guardado)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  global.fetch = fetchOriginal;
}
test.beforeEach(restaurarEnv);
test.afterEach(restaurarEnv);

function configurar() {
  process.env.RESPALDO_DRIVE_URL = URL_SCRIPT;
  process.env.RESPALDO_DRIVE_CLAVE = CLAVE;
}

/** Instante de México (UTC−6 todo el año) → Date. */
const enMexico = (fecha, hora) => new Date(`${fecha}T${hora}:00-06:00`);

const ordenadas = (filas) => filas.map((f) => JSON.stringify(f)).sort();

/**
 * Un salón con un poco de todo, incluido el ciclo real de la base:
 * un anticipo de la Agenda (cita con items tipo anticipo) ligado a su cita
 * agendada, la cita agendada que apunta a ese cobro, y una cita de la v50
 * que tomó ese anticipo (anticipo_origen_id → citas).
 */
async function sembrar(sql) {
  const [s] = await sql`
    insert into salones (salon_id, nombre, pin_hash, pin_hash_v2, servicios, productos, trabajadoras)
    values ('salon_002', 'Martha Rodriguez Hair Artist', '', ${pepperedPinHash('111111')},
            '["Corte","Tinte","Balayage"]'::jsonb, '["Shampoo"]'::jsonb,
            ${JSON.stringify([{ nombre: 'Aly', pin_hash: pepperedPinHash('222222'), permisos: { telefonos: true } }, { nombre: 'Bety' }])}::jsonb)
    returning id
  `;
  const salonId = s.id;
  await sql`
    insert into clientas (salon_id, clienta, clienta_normalizada, nota_fija, actualizado, telefono)
    values (${salonId}, 'María López', 'maria lopez', 'Alergia al amoniaco; usa "sin PPD"', '2026-10-01', '8112345678'),
           (${salonId}, 'Ana O''Neil', 'ana o''neil', '', null, '')
  `;
  const [agendada] = await sql`
    insert into citas_agendadas (salon_id, clienta, fecha, hora, anticipo, anticipo_metodo_pago, nota, estado)
    values (${salonId}, 'María López', '2026-10-10', '11:30', 500, 'Transferencia', 'Balayage', 'completada')
    returning id
  `;
  const [deposito] = await sql`
    insert into citas (salon_id, fecha, "timestamp", clienta, items, total, metodo_pago, nota, agenda_id)
    values (${salonId}, '2026-10-03', '10:00:00', 'María López', '[{"tipo":"anticipo","nombre":"Anticipo","costo":500}]'::jsonb,
            500, 'Transferencia', '', ${agendada.id})
    returning id
  `;
  await sql`update citas_agendadas set deposito_cita_id = ${deposito.id} where id = ${agendada.id}`;
  await sql`update citas set deleted_at = '2026-10-10T17:00:00Z' where id = ${deposito.id}`;
  await sql`
    insert into citas (salon_id, fecha, "timestamp", clienta, items, total, metodo_pago, nota, anticipo, anticipo_origen_id, agenda_id)
    values (${salonId}, '2026-10-10', '12:45:10', 'María López',
            '[{"tipo":"servicio","nombre":"Balayage","costo":2500.5},{"tipo":"producto","nombre":"Shampoo","costo":320}]'::jsonb,
            2820.5, 'Tarjeta', 'Fórmula: 7.1 + 20 vol\nEnjuague frío', 500, ${deposito.id}, ${agendada.id})
  `;
  for (let i = 0; i < 12; i++) {
    await sql`
      insert into citas (salon_id, fecha, "timestamp", clienta, items, total, metodo_pago, nota)
      values (${salonId}, ${`2026-10-${String(11 + i).padStart(2, '0')}`}, ${`1${i % 10}:00:00`}, 'Ana O''Neil',
              '[{"tipo":"servicio","nombre":"Corte","costo":350}]'::jsonb, 350, 'Efectivo', '')
    `;
  }
  await sql`
    insert into comisiones (salon_id, fecha, "timestamp", clienta, trabajadora, item, tipo, costo, pct, comision)
    values (${salonId}, '2026-10-10', '12:45:10', 'María López', 'Aly', 'Balayage', 'servicio', 2500.5, 30, 750.15)
  `;
  await sql`
    insert into gastos (salon_id, fecha, "timestamp", descripcion, monto, metodo_pago, deleted_at)
    values (${salonId}, '2026-10-12', '09:00:00', 'Tinte 7.1 (6 tubos)', 870.4, 'Efectivo', null),
           (${salonId}, '2026-10-13', '09:30:00', 'Borrado', 10, 'Efectivo', '2026-10-13T16:00:00Z')
  `;
  await sql`insert into ausencias (salon_id, trabajadora, desde, hasta, nota) values (${salonId}, null, '2026-12-24', '2026-12-26', 'Navidad')`;
  await sql`
    insert into push_subscriptions (salon_id, endpoint, p256dh, auth)
    values (${salonId}, 'https://push.example/abc', 'p256', 'auth')
  `;
  await sql`
    insert into webauthn_credentials (salon_id, role, worker, credential_id, public_key, counter, device_label)
    values (${salonId}, 'trabajadora', 'Aly', 'cred-1', 'pk-1', 9007199254, 'iPhone de Aly')
  `;
  await sql`insert into login_attempts (ip, success) values ('1.2.3.4', false)`;
  return salonId;
}

test('la constante de la última migración es la última de scripts/migrations', () => {
  const ultima = fs.readdirSync(path.join(__dirname, '../scripts/migrations')).filter((f) => f.endsWith('.sql')).sort().at(-1);
  assert.equal(`${respaldo.ULTIMA_MIGRACION}.sql`, ultima);
});

test('exportar → restaurar en una base vacía deja cada tabla idéntica, y nunca pisa datos', async () => {
  const a = await crearEntorno();
  await sembrar(a.sql);
  const datos = await respaldo.exportar(a.sql, { ahora: enMexico('2026-10-24', '03:00') });

  assert.equal(datos.formato, 'marthardz-respaldo');
  assert.equal(datos.migracion, respaldo.ULTIMA_MIGRACION);
  assert.equal(datos.creado_at, '2026-10-24T09:00:00.000Z');
  for (const t of respaldo.OMITIDAS) assert.ok(!(t in datos.tablas), `${t} no va en el respaldo`);
  assert.deepEqual(datos.omitidas, ['login_attempts', 'respaldos']);
  // Todas las demás tablas de la base sí van.
  assert.deepEqual([...datos.orden].sort(), [
    'ausencias', 'citas', 'citas_agendadas', 'clientas', 'comisiones', 'gastos', 'push_subscriptions', 'salones', 'webauthn_credentials',
  ]);
  // Llaves foráneas: salones antes que todo; citas antes que citas_agendadas
  // (su referencia citas.agenda_id es la que se difiere).
  assert.equal(datos.orden[0], 'salones');
  assert.ok(datos.orden.indexOf('citas') < datos.orden.indexOf('citas_agendadas'));
  const plan = await respaldo.planDeCarga(a.sql);
  assert.deepEqual(plan.diferidas, { citas: ['anticipo_origen_id', 'agenda_id'] });
  assert.ok(datos.tablas.citas.some((c) => c.agenda_id), 'hay cobros ligados a su cita agendada');
  assert.ok(datos.tablas.citas.some((c) => c.anticipo_origen_id), 'hay una cita que tomó un anticipo');
  assert.ok(datos.tablas.citas_agendadas.some((c) => c.deposito_cita_id), 'hay anticipos ligados a su cobro');
  assert.ok(Array.isArray(datos.tablas.citas[0].items), 'el jsonb sale como JSON');
  assert.ok(Array.isArray(datos.tablas.salones[0].trabajadoras), 'el jsonb de salones sale como JSON');

  // El archivo comprimido se lee de vuelta igual.
  const { archivo, sha256 } = respaldo.empaquetar(datos);
  assert.equal(archivo[0], 0x1f, 'es gzip');
  assert.equal(sha256, crypto.createHash('sha256').update(archivo).digest('hex'));
  const leido = respaldo.leerArchivo(archivo);
  assert.deepEqual(leido, JSON.parse(JSON.stringify(datos)));

  const b = await crearEntorno();
  const r = await respaldo.restaurar(b.sql, leido);
  assert.equal(r.filas, respaldo.contarFilas(datos));
  assert.equal(r.tablas, datos.orden.length);
  const otra = await respaldo.exportar(b.sql);
  for (const t of datos.orden) assert.deepEqual(ordenadas(otra.tablas[t]), ordenadas(datos.tablas[t]), `tabla ${t} idéntica`);
  // Tipos reales, no solo el texto: montos, fechas, bigint y el ciclo.
  const [cita] = await b.sql`select total, fecha::text as fecha, anticipo, anticipo_origen_id, agenda_id from citas where anticipo > 0`;
  assert.equal(Number(cita.total), 2820.5);
  assert.equal(cita.fecha, '2026-10-10');
  const [deposito] = await b.sql`select id, agenda_id from citas where id = ${cita.anticipo_origen_id}`;
  const [agendada] = await b.sql`select id, deposito_cita_id from citas_agendadas where id = ${cita.agenda_id}`;
  assert.equal(agendada.deposito_cita_id, deposito.id);
  assert.equal(deposito.agenda_id, agendada.id);
  const [cred] = await b.sql`select counter::text as counter from webauthn_credentials`;
  assert.equal(cred.counter, '9007199254');

  // La app funciona sobre la base restaurada: la dueña entra con su PIN.
  const login = await b.llamar('login', { method: 'POST', body: { pin: '111111' } });
  assert.equal(login.statusCode, 200, JSON.stringify(login.body));

  // Ya tiene datos: no se vuelve a cargar encima, y no cambia nada.
  await assert.rejects(respaldo.restaurar(b.sql, leido), /ya tiene datos/);
  const [{ n }] = await b.sql`select count(*)::int as n from citas`;
  assert.equal(n, datos.tablas.citas.length);
  await a.cerrar();
  await b.cerrar();
});

test('restaurar: una tabla con datos frena todo, aunque las demás estén vacías', async () => {
  const a = await crearEntorno();
  await sembrar(a.sql);
  const datos = await respaldo.exportar(a.sql);
  const b = await crearEntorno();
  await b.sql`insert into salones (salon_id, nombre) values ('otro', 'Otro')`;
  await assert.rejects(respaldo.restaurar(b.sql, datos), /ya tiene datos \(salones\)/);
  const [{ n }] = await b.sql`select count(*)::int as n from citas`;
  assert.equal(n, 0, 'no cargó nada');
  await a.cerrar();
  await b.cerrar();
});

test('restaurar es todo o nada: si una fila falla, no queda ninguna', async () => {
  const a = await crearEntorno();
  await sembrar(a.sql);
  const datos = JSON.parse(JSON.stringify(await respaldo.exportar(a.sql)));
  // Un gasto sin descripción (not null) rompe el insert de gastos, que va
  // después de salones y citas.
  datos.tablas.gastos[0].descripcion = null;
  const b = await crearEntorno();
  await assert.rejects(respaldo.restaurar(b.sql, datos));
  for (const t of datos.orden) {
    const [{ hay }] = await b.sql.query(`select exists (select 1 from "${t}") as hay`);
    assert.equal(hay, false, `${t} quedó vacía`);
  }
  await a.cerrar();
  await b.cerrar();
});

test('leerArchivo: rechaza lo que no es un respaldo de Martha Rdz', () => {
  assert.throws(() => respaldo.leerArchivo(Buffer.from('hola')), /no es un respaldo/);
  assert.throws(() => respaldo.leerArchivo(zlib.gzipSync(Buffer.from('{"formato":"punto31-respaldo","version":1}'))), /no es un respaldo de Martha Rdz/);
  assert.throws(() => respaldo.leerArchivo(Buffer.from('{"formato":"marthardz-respaldo","version":9}')), /versión 9/);
  assert.throws(() => respaldo.leerArchivo(Buffer.from('{"formato":"marthardz-respaldo","version":1}')), /incompleto/);
});

/** Un Apps Script falso: guarda lo que le llega y responde como el de verdad. */
function scriptFalso(respuesta = () => ({ ok: true, id: 'drive-1', carpeta_url: CARPETA_URL, borrados: 0 })) {
  const recibidos = [];
  global.fetch = async (url, opts) => {
    const p = JSON.parse(opts.body);
    recibidos.push({ url, opts, ...p });
    const r = typeof respuesta === 'function' ? respuesta(p) : respuesta;
    if (r instanceof Error) throw r;
    if (r.status) return { ok: false, status: r.status, text: async () => '<html>Error</html>' };
    if (r.html) return { ok: true, status: 200, text: async () => '<html>Inicia sesión</html>' };
    return { ok: true, status: 200, text: async () => JSON.stringify(r) };
  };
  return recibidos;
}

test('respaldar: manda el archivo con clave y huella, anota cada intento y nunca lanza', async () => {
  const t = await crearEntorno();
  await sembrar(t.sql);
  assert.deepEqual(await respaldo.respaldar(t.sql), { ok: false, sin_configurar: true });
  const [{ n: sinNada }] = await t.sql`select count(*)::int as n from respaldos`;
  assert.equal(sinNada, 0, 'sin configurar no anota nada');

  configurar();
  const recibidos = scriptFalso();
  const r = await respaldo.respaldar(t.sql, { origen: 'cron', ahora: enMexico('2026-10-24', '03:00') });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.archivo, 'marthardz-respaldo-2026-10-24.json.gz');
  const [p] = recibidos;
  assert.equal(p.url, URL_SCRIPT);
  assert.equal(p.opts.method, 'POST');
  assert.equal(p.opts.redirect, 'follow', 'Google responde 302 y fetch lo sigue');
  assert.ok(p.opts.signal, 'lleva límite de tiempo');
  assert.equal(p.clave, CLAVE);
  assert.equal(p.nombre, 'marthardz-respaldo-2026-10-24.json.gz');
  const bytes = Buffer.from(p.contenido, 'base64');
  assert.equal(bytes.length, p.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), p.sha256);
  const contenido = respaldo.leerArchivo(bytes);
  assert.equal(respaldo.contarFilas(contenido), r.filas);
  assert.ok(r.filas > 20);
  const [fila] = await t.sql`select origen, ok, archivo, bytes, filas, drive_id, carpeta_url, error from respaldos`;
  assert.deepEqual({ ...fila }, {
    origen: 'cron', ok: true, archivo: r.archivo, bytes: bytes.length, filas: r.filas, drive_id: 'drive-1', carpeta_url: CARPETA_URL, error: null,
  });

  // El manual lleva la hora para no pisar el de la noche.
  const manual = await respaldo.respaldar(t.sql, { origen: 'manual', ahora: enMexico('2026-10-24', '15:42') });
  assert.equal(manual.archivo, 'marthardz-respaldo-2026-10-24-1542.json.gz');
  assert.equal((await respaldo.respaldar(t.sql, { origen: 'manual', ahora: enMexico('2026-10-24', '09:05') })).archivo,
    'marthardz-respaldo-2026-10-24-0905.json.gz');

  // Fallas: clave equivocada, Google con error, sin red, sin respuesta, una
  // página en vez de JSON. Se anotan con su motivo y no lanzan.
  const fallas = [
    [{ ok: false, error: 'Clave incorrecta: revisa RESPALDO_DRIVE_CLAVE' }, /Clave incorrecta/],
    [{ status: 500 }, /Google Drive respondió 500/],
    [new TypeError('fetch failed'), /No se pudo conectar con Google Drive/],
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), /no respondió a tiempo/],
    [{ html: true }, /no respondió como se esperaba/],
  ];
  let minuto = 50;
  for (const [respuesta, motivo] of fallas) {
    scriptFalso(respuesta);
    const mal = await respaldo.respaldar(t.sql, { ahora: enMexico('2026-10-24', `15:${minuto++}`) });
    assert.equal(mal.ok, false);
    assert.match(mal.error, motivo);
  }
  // Ni la base puede tumbarlo: si exportar falla, se anota y regresa el error.
  scriptFalso();
  const sqlRoto = Object.assign(async () => { throw new Error('se cayó la base'); }, { query: () => Promise.reject(new Error('x')) });
  const roto = await respaldo.respaldar(sqlRoto, { ahora: enMexico('2026-10-24', '16:10') });
  assert.equal(roto.ok, false);
  assert.match(roto.error, /se cayó la base/);

  const estado = await respaldo.leerEstado(t.sql, { ahora: enMexico('2026-10-24', '16:00') });
  assert.equal(estado.estado, 'fallo');
  assert.equal(estado.ultimos.length, 8);
  assert.match(estado.ultimos[0].error, /no respondió como se esperaba/);
  assert.equal(estado.ultimo_ok.at, enMexico('2026-10-24', '15:42').toISOString());
  assert.equal(estado.ultimo_ok.filas, r.filas);
  assert.ok(estado.ultimo_ok.bytes > 0);
  assert.equal(estado.carpeta_url, CARPETA_URL);
  const texto = JSON.stringify(estado);
  assert.ok(!texto.includes(CLAVE), 'la clave nunca sale');
  assert.ok(!texto.includes(URL_SCRIPT), 'la URL del script nunca sale');
  await t.cerrar();
});

test('estados: nunca → fallo → al día → atrasado (más de 30 h) → sin configurar', async () => {
  const t = await crearEntorno();
  await sembrar(t.sql);
  assert.equal((await respaldo.leerEstado(t.sql)).estado, 'sin_configurar');
  configurar();
  const vacio = await respaldo.leerEstado(t.sql);
  assert.equal(vacio.estado, 'nunca');
  assert.equal(vacio.ultimo_ok, null);
  assert.deepEqual(vacio.ultimos, []);

  scriptFalso({ status: 500 });
  await respaldo.respaldar(t.sql, { ahora: enMexico('2026-10-23', '03:00') });
  assert.equal((await respaldo.leerEstado(t.sql, { ahora: enMexico('2026-10-23', '08:00') })).estado, 'fallo');

  scriptFalso();
  await respaldo.respaldar(t.sql, { ahora: enMexico('2026-10-24', '03:00') });
  assert.equal((await respaldo.leerEstado(t.sql, { ahora: enMexico('2026-10-24', '08:00') })).estado, 'al_dia');
  // 30 h justas todavía está al día; 31 h ya no.
  assert.equal((await respaldo.leerEstado(t.sql, { ahora: enMexico('2026-10-25', '09:00') })).estado, 'al_dia');
  assert.equal((await respaldo.leerEstado(t.sql, { ahora: enMexico('2026-10-25', '10:00') })).estado, 'atrasado');

  // Con DEMO=1 no se respalda aunque tenga las variables.
  process.env.DEMO = '1';
  assert.equal((await respaldo.respaldar(t.sql)).sin_configurar, true);
  assert.equal((await respaldo.leerEstado(t.sql)).estado, 'sin_configurar');
  await t.cerrar();
});

test('cron tarea=respaldo: exige CRON_SECRET, 200 si sale, 502 si falla; la limpieza sigue igual', async () => {
  const t = await crearEntorno();
  await sembrar(t.sql);
  const cron = (headers = { authorization: 'Bearer secreto' }, query = { tarea: 'respaldo' }) =>
    t.llamar('cron/limpieza', { query, headers });

  delete process.env.CRON_SECRET;
  assert.equal((await cron({})).statusCode, 503, 'sin CRON_SECRET el respaldo no corre');
  assert.equal((await cron({}, {})).statusCode, 200, 'la limpieza sin CRON_SECRET sigue como antes');

  process.env.CRON_SECRET = 'secreto';
  assert.equal((await cron({})).statusCode, 401);
  assert.equal((await cron({ authorization: 'Bearer otro' })).statusCode, 401);
  assert.equal((await cron({ authorization: 'Bearer secreto' }, { tarea: 'otra' })).statusCode, 400);
  let r = await cron();
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.respaldo, 'sin_configurar');

  configurar();
  scriptFalso();
  r = await cron();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.respaldo, 'ok');
  assert.match(r.body.archivo, /^marthardz-respaldo-\d{4}-\d{2}-\d{2}\.json\.gz$/);
  scriptFalso({ ok: false, error: 'El archivo llegó dañado (la huella no coincide)' });
  r = await cron();
  assert.equal(r.statusCode, 502);
  assert.match(r.body.error, /dañado/);
  assert.ok(!JSON.stringify(r.body).includes(CLAVE));

  process.env.DEMO = '1';
  r = await cron();
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.respaldo, 'sin_configurar');

  // Sin tarea: la limpieza de siempre.
  await t.sql`insert into login_attempts (ip, success, attempted_at) values ('9.9.9.9', false, now() - interval '40 days')`;
  r = await cron({ authorization: 'Bearer secreto' }, {});
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.intentos_borrados, 1);
  await t.cerrar();
});

test('Configuración → Respaldo: solo la dueña; 409 sin configurar; nunca toca el catálogo', async () => {
  const t = await crearEntorno();
  const salonId = await sembrar(t.sql);
  const duena = createSessionToken(salonId);
  const trabajadora = createSessionToken(salonId, { role: 'trabajadora', worker: 'Aly' });
  configurar();

  assert.equal((await t.llamar('config', { query: { vista: 'respaldo' } })).statusCode, 401);
  assert.equal((await t.llamar('config', { token: trabajadora, query: { vista: 'respaldo' } })).statusCode, 403);
  const recibidos = scriptFalso();
  assert.equal((await t.llamar('config', { token: trabajadora, method: 'POST', body: { accion: 'respaldar' } })).statusCode, 403);
  assert.equal(recibidos.length, 0, 'la trabajadora no dispara nada');

  let vista = await t.llamar('config', { token: duena, query: { vista: 'respaldo' } });
  assert.equal(vista.statusCode, 200);
  assert.equal(vista.body.estado, 'nunca');

  const manual = await t.llamar('config', { token: duena, method: 'POST', body: { accion: 'respaldar' } });
  assert.equal(manual.statusCode, 200, JSON.stringify(manual.body));
  assert.match(manual.body.archivo, /^marthardz-respaldo-\d{4}-\d{2}-\d{2}-\d{4}\.json\.gz$/);
  assert.equal(manual.body.estado.estado, 'al_dia');
  assert.equal(manual.body.estado.ultimos[0].origen, 'manual');

  scriptFalso({ ok: false, error: 'Clave incorrecta: revisa RESPALDO_DRIVE_CLAVE' });
  const mal = await t.llamar('config', { token: duena, method: 'POST', body: { accion: 'respaldar' } });
  assert.equal(mal.statusCode, 502);
  assert.match(mal.body.error, /No se pudo respaldar: Clave incorrecta/);
  assert.equal(mal.body.estado.estado, 'fallo');

  vista = await t.llamar('config', { token: duena, query: { vista: 'respaldo' } });
  for (const cuerpo of [vista.body, manual.body, mal.body]) {
    const texto = JSON.stringify(cuerpo);
    assert.ok(!texto.includes(CLAVE) && !texto.includes(URL_SCRIPT), 'ni la clave ni la URL salen');
  }

  // Una acción desconocida nunca cae en el guardado del catálogo.
  const [antes] = await t.sql`select servicios, productos, trabajadoras from salones where id = ${salonId}`;
  assert.equal((await t.llamar('config', { token: duena, method: 'POST', body: { accion: 'borrar_todo' } })).statusCode, 400);
  const [despues] = await t.sql`select servicios, productos, trabajadoras from salones where id = ${salonId}`;
  assert.deepEqual(despues, antes);

  // GET normal de Configuración sigue igual.
  const config = await t.llamar('config', { token: duena });
  assert.deepEqual(config.body.servicios, ['Corte', 'Tinte', 'Balayage']);

  delete process.env.RESPALDO_DRIVE_URL;
  const sinConfig = await t.llamar('config', { token: duena, method: 'POST', body: { accion: 'respaldar' } });
  assert.equal(sinConfig.statusCode, 409);
  vista = await t.llamar('config', { token: duena, query: { vista: 'respaldo' } });
  assert.equal(vista.body.estado, 'sin_configurar');
  assert.equal(vista.body.configurado, false);
  await t.cerrar();
});

/* ------------------------------------------------ Apps Script (simulado) */

function cargarAppsScript({ archivos = [], ahora = '2026-10-24T15:00:00Z' } = {}) {
  const enCarpeta = archivos.map((nombre) => ({ nombre, papelera: false }));
  const vivos = () => enCarpeta.filter((f) => !f.papelera);
  const iterar = (lista) => {
    let i = 0;
    return { hasNext: () => i < lista.length, next: () => lista[i++] };
  };
  const envolver = (f) => ({
    getName: () => f.nombre, setTrashed: (v) => { f.papelera = v; }, getId: () => `id-${f.nombre}`,
    getUrl: () => `https://drive/${f.nombre}`, setDescription: (d) => { f.descripcion = d; },
  });
  const correos = [];
  const disparadores = [];
  const carpeta = {
    getFilesByName: (n) => iterar(vivos().filter((f) => f.nombre === n).map(envolver)),
    getFiles: () => iterar(vivos().map(envolver)),
    createFile: (blob) => {
      const f = { nombre: blob.nombre, bytes: blob.bytes, tipo: blob.tipo, papelera: false };
      enCarpeta.push(f);
      return envolver(f);
    },
    getUrl: () => CARPETA_URL,
    getName: () => 'Martha Rdz - Base de Datos',
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [ahora])); }
    static now() { return new RealDate(ahora).getTime(); }
  }
  const constructor = (handler) => {
    const t = { handler, cada: null, hora: null, zona: null };
    const b = {
      timeBased: () => b, everyDays: (n) => { t.cada = n; return b; }, atHour: (h) => { t.hora = h; return b; },
      inTimezone: (z) => { t.zona = z; return b; }, create: () => { disparadores.push(t); return t; },
    };
    return b;
  };
  const ctx = {
    Date: FakeDate,
    Utilities: {
      base64Decode: (s) => [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (_alg, bytes) => [...crypto.createHash('sha256').update(Buffer.from(bytes.map((b) => (b + 256) % 256))).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      newBlob: (bytes, tipo, nombre) => ({ bytes, tipo, nombre }),
      formatDate: (d, zona, formato) => {
        assert.equal(formato, 'yyyy-MM-dd');
        return new RealDate(d.getTime()).toLocaleDateString('en-CA', { timeZone: zona });
      },
    },
    DriveApp: { getFolderById: (id) => { assert.equal(id, 'CARPETA'); return carpeta; } },
    ContentService: { createTextOutput: (texto) => ({ texto, setMimeType() { return JSON.parse(texto); } }), MimeType: { JSON: 'json' } },
    MailApp: { sendEmail: (...a) => correos.push(a), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'jesusangelsr12@gmail.com' }) },
    ScriptApp: {
      getProjectTriggers: () => disparadores.map((t) => ({ getHandlerFunction: () => t.handler, t })),
      deleteTrigger: (x) => disparadores.splice(disparadores.indexOf(x.t), 1),
      newTrigger: constructor,
    },
    Logger: { log: () => {} },
  };
  const fuente = fs.readFileSync(path.join(__dirname, '../scripts/respaldo-drive.gs'), 'utf8');
  assert.ok(fuente.includes("const CLAVE = 'PEGA_AQUI_LA_CLAVE';"), 'el repositorio nunca guarda la clave real');
  assert.ok(fuente.includes("const CARPETA_ID = 'PEGA_AQUI_EL_ID_DE_LA_CARPETA';"));
  vm.createContext(ctx);
  vm.runInContext(fuente.replace("'PEGA_AQUI_LA_CLAVE'", `'${CLAVE}'`).replace("'PEGA_AQUI_EL_ID_DE_LA_CARPETA'", "'CARPETA'"), ctx);
  return { ctx, vivos: () => vivos().map((f) => f.nombre).sort(), enCarpeta, correos, disparadores };
}

const post = (ctx, p) => ctx.doPost({ postData: { contents: JSON.stringify(p) } });

function paquete(nombre) {
  const archivo = zlib.gzipSync(Buffer.from('{"formato":"marthardz-respaldo"}'));
  return {
    clave: CLAVE, nombre, bytes: archivo.length,
    sha256: crypto.createHash('sha256').update(archivo).digest('hex'), contenido: archivo.toString('base64'),
  };
}

test('Apps Script: guarda, reemplaza el del mismo día, deja 30 días + el día 1 y no toca lo ajeno', () => {
  const viejos = [
    'marthardz-respaldo-2026-08-01.json.gz', // día 1: se queda para siempre
    'marthardz-respaldo-2026-09-15.json.gz', // más de 30 días: se va
    'marthardz-respaldo-2026-09-20-1530.json.gz', // manual de hace más de 30 días: se va
    'marthardz-respaldo-2026-09-24.json.gz', // justo 30 días: se queda
    'marthardz-respaldo-2026-10-24.json.gz', // el de hoy: se reemplaza
    'punto31-respaldo-2026-01-15.json.gz', // de otra app: no se toca
    'notas de Jesús.txt',
  ];
  const s = cargarAppsScript({ archivos: viejos });
  const bien = paquete('marthardz-respaldo-2026-10-24.json.gz');

  assert.deepEqual(post(s.ctx, { ...bien, clave: 'otra' }), { ok: false, error: 'Clave incorrecta: revisa RESPALDO_DRIVE_CLAVE' });
  assert.equal(post(s.ctx, { ...bien, clave: '' }).ok, false);
  assert.match(post(s.ctx, { ...bien, nombre: '../otro.txt' }).error, /Nombre de archivo inválido/);
  assert.match(post(s.ctx, { ...bien, nombre: 'punto31-respaldo-2026-10-24.json.gz' }).error, /Nombre de archivo inválido/);
  assert.match(post(s.ctx, { ...bien, bytes: 3 }).error, /incompleto/);
  assert.match(post(s.ctx, { ...bien, contenido: '' }).error, /incompleto/);
  assert.match(post(s.ctx, { ...bien, sha256: '00' }).error, /dañado/);
  assert.match(s.ctx.doPost({ postData: { contents: 'no es json' } }).error, /Error en el Apps Script/);
  assert.deepEqual(s.vivos(), [...viejos].sort(), 'nada de lo rechazado tocó la carpeta');

  const r = post(s.ctx, bien);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.carpeta_url, CARPETA_URL);
  assert.equal(r.id, 'id-marthardz-respaldo-2026-10-24.json.gz');
  assert.equal(r.borrados, 2, 'el del 15 y el manual del 20 de septiembre');
  assert.deepEqual(s.vivos(), [
    'marthardz-respaldo-2026-08-01.json.gz',
    'marthardz-respaldo-2026-09-24.json.gz',
    'marthardz-respaldo-2026-10-24.json.gz',
    'notas de Jesús.txt',
    'punto31-respaldo-2026-01-15.json.gz',
  ], 'el de hoy quedó uno solo y lo ajeno no se tocó');
  const nuevo = s.enCarpeta.find((f) => !f.papelera && f.nombre === bien.nombre);
  assert.equal(nuevo.tipo, 'application/gzip');
  assert.equal(Buffer.from(nuevo.bytes.map((b) => (b + 256) % 256)).toString('base64'), bien.contenido, 'guarda los bytes tal cual');

  // El manual (con hora) no pisa el de la noche.
  assert.equal(post(s.ctx, paquete('marthardz-respaldo-2026-10-24-1542.json.gz')).ok, true);
  assert.ok(s.vivos().includes('marthardz-respaldo-2026-10-24.json.gz'));
  assert.ok(s.vivos().includes('marthardz-respaldo-2026-10-24-1542.json.gz'));
});

test('Apps Script: el vigilante avisa por correo solo si hoy no llegó, e instalar lo deja uno solo a las 7:00', () => {
  const s = cargarAppsScript({ archivos: ['marthardz-respaldo-2026-10-24.json.gz'] });
  s.ctx.revisarRespaldo();
  assert.equal(s.correos.length, 0, 'hoy sí llegó');

  // 23 de octubre a las 7:00 de Monterrey (13:00 UTC): solo hay uno de otra app.
  const otro = cargarAppsScript({ archivos: ['punto31-respaldo-2026-10-23.json.gz', 'marthardz-respaldo-2026-10-22.json.gz'], ahora: '2026-10-23T13:00:00Z' });
  otro.ctx.revisarRespaldo();
  assert.equal(otro.correos.length, 1);
  const [para, asunto, cuerpo] = otro.correos[0];
  assert.equal(para, 'jesusangelsr12@gmail.com');
  assert.match(asunto, /Martha Rdz/);
  assert.match(cuerpo, /2026-10-23/);
  assert.match(cuerpo, /Martha Rdz - Base de Datos/);

  // Un manual de hoy también cuenta como "llegó".
  const manual = cargarAppsScript({ archivos: ['marthardz-respaldo-2026-10-24-1542.json.gz'] });
  manual.ctx.revisarRespaldo();
  assert.equal(manual.correos.length, 0);

  s.ctx.instalar();
  s.ctx.instalar();
  assert.equal(s.disparadores.length, 1, 'correrlo dos veces no duplica el vigilante');
  assert.deepEqual({ ...s.disparadores[0] }, { handler: 'revisarRespaldo', cada: 1, hora: 7, zona: 'America/Monterrey' });
});
