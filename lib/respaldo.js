/**
 * Respaldo diario de la base completa a Google Drive.
 *
 * Neon (plan gratuito) solo guarda 6 horas de historia, así que cada noche
 * (cron `/api/cron/limpieza?tarea=respaldo`, 3:00 en México) y cuando la
 * dueña toca «Respaldar ahora» (Configuración → Respaldo) se exporta toda la
 * base a un archivo `.json.gz` y se manda a un Google Apps Script de la
 * cuenta dueña de la carpeta «Martha Rdz - Base de Datos»
 * (scripts/respaldo-drive.gs). El script corre como esa cuenta, así que el
 * archivo usa su espacio de Drive: una cuenta de servicio no sirve aquí
 * porque en un Drive personal no tiene espacio propio.
 *
 *   RESPALDO_DRIVE_URL    URL de la app web del Apps Script (…/exec)
 *   RESPALDO_DRIVE_CLAVE  la misma clave que la constante CLAVE del script
 *
 * El archivo: { formato, version, creado_at, migracion, orden, omitidas,
 * columnas: { tabla: [col…] }, tablas: { tabla: [fila…] } }. Cada fila sale
 * de `to_jsonb(t)`: fechas en texto ISO, arreglos y jsonb como JSON, bytea
 * en hex. `restaurar()` la regresa con `jsonb_populate_recordset`, que
 * convierte todo de vuelta a su tipo, en el orden de llaves foráneas de la
 * base de destino (planDeCarga; las referencias en ciclo van en dos pasos).
 *
 * Fuera del respaldo: login_attempts (el cron la limpia a los 30 días y solo
 * sirve para el límite de intentos del momento) y la propia bitácora de
 * respaldos.
 *
 * Con DEMO=1 no se respalda nada aunque alguien copie las variables.
 *
 * `ahora` (en respaldar y leerEstado) es para pruebas, igual que en
 * fechaMexico: en producción siempre es la hora real.
 */

const zlib = require('zlib');
const crypto = require('crypto');
const { fechaMexico, horaMexico } = require('./fecha');

const FORMATO = 'marthardz-respaldo';
const PREFIJO = 'marthardz-respaldo-';
const VERSION = 1;
// La última migración de scripts/migrations/ (test/respaldo.test.js lo vigila).
const ULTIMA_MIGRACION = '010_rol_app_runtime';
const OMITIDAS = ['login_attempts', 'respaldos'];
const LOTE_RESTAURAR = 500;
const TIEMPO_SUBIDA_MS = 40_000;
const ULTIMOS = 10;
// El cron corre cada 24 h: más de 30 h sin uno bueno es que algo se atoró.
const HORAS_ATRASO = 30;

const configurado = () => !!(process.env.RESPALDO_DRIVE_URL && process.env.RESPALDO_DRIVE_CLAVE) && process.env.DEMO !== '1';

const ident = (n) => `"${String(n).replace(/"/g, '""')}"`;

/**
 * Cómo cargar la base sin romper llaves foráneas → { orden, diferidas, pk, columnas }
 *
 *  orden      tablas de `public`: si B apunta a A, A va antes.
 *  diferidas  { tabla: [columna…] } que se cargan vacías (null) y se llenan
 *             al final con un update: las que apuntan a su propia tabla
 *             (citas.anticipo_origen_id) y las que cierran un ciclo
 *             (citas.agenda_id ↔ citas_agendadas.deposito_cita_id). Solo
 *             columnas que aceptan null; si un ciclo no tiene ninguna, falla.
 *  pk         { tabla: [columna…] } para encontrar la fila en ese update.
 */
async function planDeCarga(sql) {
  const [tablas, cols, fks, pks] = await Promise.all([
    sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    sql`
      select table_name as t, column_name as c, is_nullable = 'YES' as nulo from information_schema.columns
      where table_schema = 'public' order by table_name, ordinal_position
    `,
    sql`
      select c.relname as t, r.relname as ref, k.conname as nombre,
             (select string_agg(a.attname, ',' order by u.i) from unnest(k.conkey) with ordinality as u(n, i)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n) as cols
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_class r on r.oid = k.confrelid
      join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'
      order by c.relname, k.conname
    `,
    sql`
      select c.relname as t,
             (select string_agg(a.attname, ',' order by u.i) from unnest(k.conkey) with ordinality as u(n, i)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n) as cols
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'p' and n.nspname = 'public'
    `,
  ]);
  const nombres = tablas.map((x) => x.t);
  const columnas = {};
  const nulas = new Set();
  for (const { t, c, nulo } of cols) {
    (columnas[t] ||= []).push(c);
    if (nulo) nulas.add(`${t}.${c}`);
  }
  const pk = Object.fromEntries(pks.map((x) => [x.t, x.cols.split(',')]));
  const diferidas = {};
  const diferir = (t, cs) => { diferidas[t] = [...new Set([...(diferidas[t] || []), ...cs])]; };
  const aceptaNull = (t, cs) => cs.every((c) => nulas.has(`${t}.${c}`));

  // Aristas t → ref (t necesita a ref antes).
  const aristas = new Map(nombres.map((t) => [t, []]));
  for (const f of fks) {
    if (!aristas.has(f.t) || !aristas.has(f.ref)) continue;
    const cs = f.cols.split(',');
    if (f.t === f.ref) {
      if (aceptaNull(f.t, cs)) diferir(f.t, cs);
      continue;
    }
    aristas.get(f.t).push({ ref: f.ref, cols: cs });
  }

  const orden = [];
  const listo = new Set();
  while (orden.length < nombres.length) {
    const pendientes = nombres.filter((t) => !listo.has(t));
    const sigue = pendientes.find((t) => aristas.get(t).every((a) => listo.has(a.ref)));
    if (sigue) {
      orden.push(sigue);
      listo.add(sigue);
      continue;
    }
    // Ciclo: se rompe por la primera referencia que acepta null.
    let roto = false;
    for (const t of pendientes) {
      const i = aristas.get(t).findIndex((a) => !listo.has(a.ref) && aceptaNull(t, a.cols));
      if (i === -1) continue;
      diferir(t, aristas.get(t)[i].cols);
      aristas.get(t).splice(i, 1);
      roto = true;
      break;
    }
    if (!roto) throw new Error(`Las llaves foráneas forman un ciclo sin columna opcional (${pendientes.join(', ')})`);
  }
  for (const t of Object.keys(diferidas)) {
    if (!pk[t]) throw new Error(`La tabla ${t} necesita llave primaria para cargarse en dos pasos`);
  }
  return { orden, diferidas, pk, columnas };
}

/** Toda la base (menos OMITIDAS) como objeto listo para JSON. */
async function exportar(sql, { ahora = new Date() } = {}) {
  const { orden: todas, columnas } = await planDeCarga(sql);
  const orden = todas.filter((t) => !OMITIDAS.includes(t));
  const filas = await Promise.all(orden.map((t) => sql.query(`select to_jsonb(x) as f from ${ident(t)} x`)));
  const tablas = {};
  orden.forEach((t, i) => { tablas[t] = filas[i].map((r) => r.f); });
  return {
    formato: FORMATO,
    version: VERSION,
    creado_at: ahora.toISOString(),
    migracion: ULTIMA_MIGRACION,
    orden,
    omitidas: OMITIDAS,
    columnas: Object.fromEntries(orden.map((t) => [t, columnas[t]])),
    tablas,
  };
}

const contarFilas = (datos) => Object.values(datos.tablas).reduce((n, filas) => n + filas.length, 0);

function empaquetar(datos) {
  const archivo = zlib.gzipSync(Buffer.from(JSON.stringify(datos)), { level: 9 });
  return { archivo, sha256: crypto.createHash('sha256').update(archivo).digest('hex') };
}

/** .json.gz (o .json) → objeto del respaldo, validado. */
function leerArchivo(buffer) {
  const esGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  let datos;
  try {
    datos = JSON.parse((esGzip ? zlib.gunzipSync(buffer) : buffer).toString('utf8'));
  } catch {
    throw new Error('El archivo no es un respaldo de Martha Rdz (no se pudo leer)');
  }
  if (datos?.formato !== FORMATO) throw new Error('El archivo no es un respaldo de Martha Rdz');
  if (datos.version !== VERSION) throw new Error(`Respaldo de versión ${datos.version}; este código lee la versión ${VERSION}`);
  if (!Array.isArray(datos.orden) || !datos.tablas || !datos.columnas) throw new Error('El respaldo está incompleto');
  return datos;
}

/**
 * Regresa un respaldo a una base con las migraciones aplicadas y las tablas
 * vacías (un branch nuevo de Neon «solo esquema»). Todo o nada.
 * → { tablas, filas }
 */
async function restaurar(sql, datos) {
  const plan = await planDeCarga(sql);
  const { columnas } = plan;
  const faltan = datos.orden.filter((t) => !columnas[t]);
  if (faltan.length) throw new Error(`Faltan tablas en la base: ${faltan.join(', ')}. Aplica las migraciones hasta ${datos.migracion}.`);
  for (const t of datos.orden) {
    const sinColumna = datos.columnas[t].filter((c) => !columnas[t].includes(c));
    if (sinColumna.length) throw new Error(`A la tabla ${t} le faltan columnas (${sinColumna.join(', ')}). Aplica las migraciones hasta ${datos.migracion}.`);
  }
  const conteos = await Promise.all(datos.orden.map((t) => sql.query(`select exists (select 1 from ${ident(t)}) as hay`)));
  const llenas = datos.orden.filter((_, i) => conteos[i][0].hay);
  if (llenas.length) throw new Error(`La base ya tiene datos (${llenas.join(', ')}). Restaura en un branch nuevo de Neon «solo esquema».`);

  // El orden lo decide la base de destino (sus llaves foráneas), no el archivo.
  const orden = plan.orden.filter((t) => datos.orden.includes(t));
  const lotes = (filas, fn) => {
    for (let i = 0; i < filas.length; i += LOTE_RESTAURAR) fn(JSON.stringify(filas.slice(i, i + LOTE_RESTAURAR)));
  };
  const consultas = [];
  for (const t of orden) {
    const diferidas = plan.diferidas[t] || [];
    const cols = datos.columnas[t];
    const lista = cols.map(ident).join(', ');
    const valores = cols.map((c) => (diferidas.includes(c) ? 'null' : ident(c))).join(', ');
    lotes(datos.tablas[t] || [], (json) => consultas.push(sql.query(
      `insert into ${ident(t)} (${lista}) select ${valores} from jsonb_populate_recordset(null::${ident(t)}, $1::jsonb)`,
      [json],
    )));
  }
  // Segundo paso: las referencias diferidas, ya con todas las filas adentro.
  for (const t of orden) {
    const diferidas = (plan.diferidas[t] || []).filter((c) => datos.columnas[t].includes(c));
    if (!diferidas.length) continue;
    const conValor = (datos.tablas[t] || []).filter((f) => diferidas.some((c) => f[c] !== null && f[c] !== undefined));
    const set = diferidas.map((c) => `${ident(c)} = x.${ident(c)}`).join(', ');
    const donde = plan.pk[t].map((c) => `y.${ident(c)} = x.${ident(c)}`).join(' and ');
    lotes(conValor, (json) => consultas.push(sql.query(
      `update ${ident(t)} y set ${set} from jsonb_populate_recordset(null::${ident(t)}, $1::jsonb) x where ${donde}`,
      [json],
    )));
  }
  // Las columnas con secuencia (serial) siguen después del número más alto.
  const seriales = await sql`
    select table_name as t, column_name as c from information_schema.columns
    where table_schema = 'public' and column_default like 'nextval(%'
  `;
  for (const { t, c } of seriales.filter((x) => orden.includes(x.t) && (datos.tablas[x.t] || []).length)) {
    consultas.push(sql.query(
      `select setval(pg_get_serial_sequence($1, $2), (select max(${ident(c)}) from ${ident(t)}))`,
      [ident(t), c],
    ));
  }
  if (consultas.length) await sql.transaction(consultas);
  return { tablas: orden.length, filas: contarFilas(datos) };
}

/** Manda el archivo al Apps Script. → { id, url?, carpeta_url?, borrados } */
async function subir(nombre, { archivo, sha256 }) {
  let res;
  try {
    res = await fetch(process.env.RESPALDO_DRIVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clave: process.env.RESPALDO_DRIVE_CLAVE, nombre, sha256, bytes: archivo.length, contenido: archivo.toString('base64'),
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIEMPO_SUBIDA_MS),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'Google Drive no respondió a tiempo' : `No se pudo conectar con Google Drive (${e.message})`);
  }
  const texto = await res.text();
  let r = null;
  try { r = JSON.parse(texto); } catch { /* Google respondió una página, no JSON */ }
  if (!res.ok || !r) {
    throw new Error(res.ok
      ? 'El Apps Script no respondió como se esperaba (¿la implementación es «Aplicación web» con acceso «Cualquier usuario»?)'
      : `Google Drive respondió ${res.status}`);
  }
  if (!r.ok) throw new Error(r.error || 'El Apps Script rechazó el respaldo');
  return r;
}

/** Exporta, sube y lo anota en `respaldos`. Nunca lanza: → { ok, …, error? } */
async function respaldar(sql, { origen = 'cron', ahora = new Date() } = {}) {
  if (!configurado()) return { ok: false, sin_configurar: true };
  const inicio = Date.now();
  const fecha = fechaMexico(0, ahora);
  // El cron deja uno por día (si corre dos veces, el script reemplaza el del
  // día); el manual lleva la hora para no pisarlo.
  const nombre = origen === 'manual'
    ? `${PREFIJO}${fecha}-${horaMexico(ahora).replace(':', '')}.json.gz`
    : `${PREFIJO}${fecha}.json.gz`;
  let fila = { origen, ok: false, archivo: nombre, bytes: null, filas: null, drive_id: null, carpeta_url: null, error: null };
  try {
    const datos = await exportar(sql, { ahora });
    const paquete = empaquetar(datos);
    fila = { ...fila, bytes: paquete.archivo.length, filas: contarFilas(datos) };
    const r = await subir(nombre, paquete);
    fila = { ...fila, ok: true, drive_id: r.id || null, carpeta_url: r.carpeta_url || null };
  } catch (e) {
    console.error('Respaldo a Drive:', e.message);
    fila.error = String(e.message || e).slice(0, 300);
  }
  const duracion = Date.now() - inicio;
  try {
    await sql`
      insert into respaldos (creado_at, origen, ok, archivo, bytes, filas, drive_id, carpeta_url, error, duracion_ms)
      values (${ahora.toISOString()}, ${fila.origen}, ${fila.ok}, ${fila.archivo}, ${fila.bytes}, ${fila.filas}, ${fila.drive_id}, ${fila.carpeta_url}, ${fila.error}, ${duracion})
    `;
    await sql`delete from respaldos where creado_at < now() - interval '400 days'`;
  } catch (e) {
    console.error('No se pudo anotar el respaldo:', e.message);
  }
  return { ...fila, duracion_ms: duracion };
}

/** Lo que ve la dueña en Configuración → Respaldo. Nunca trae la URL ni la clave. */
async function leerEstado(sql, { ahora = new Date() } = {}) {
  const ultimos = await sql`
    select creado_at, origen, ok, archivo, bytes, filas, error, carpeta_url
    from respaldos order by creado_at desc limit ${ULTIMOS}
  `;
  const [ultimoOk] = await sql`select creado_at, bytes, filas, carpeta_url from respaldos where ok order by creado_at desc limit 1`;
  const horas = ultimoOk ? (ahora.getTime() - new Date(ultimoOk.creado_at).getTime()) / 3600e3 : null;
  let estado = 'nunca';
  if (!configurado()) estado = 'sin_configurar';
  else if (ultimos[0] && !ultimos[0].ok) estado = 'fallo';
  else if (horas !== null) estado = horas > HORAS_ATRASO ? 'atrasado' : 'al_dia';
  return {
    configurado: configurado(),
    estado,
    ultimo_ok: ultimoOk
      ? { at: new Date(ultimoOk.creado_at).toISOString(), bytes: ultimoOk.bytes, filas: ultimoOk.filas }
      : null,
    carpeta_url: ultimoOk?.carpeta_url || null,
    ultimos: ultimos.map((r) => ({
      at: new Date(r.creado_at).toISOString(), origen: r.origen, ok: r.ok, archivo: r.archivo,
      bytes: r.bytes, filas: r.filas, error: r.error,
    })),
  };
}

module.exports = {
  configurado, planDeCarga, exportar, empaquetar, leerArchivo, restaurar, subir, respaldar, leerEstado, contarFilas,
  ULTIMA_MIGRACION, OMITIDAS, FORMATO, PREFIJO, HORAS_ATRASO,
};
