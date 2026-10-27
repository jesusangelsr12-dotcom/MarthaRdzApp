/**
 * Base de datos de prueba para correr los handlers de api/ de verdad.
 *
 * Levanta Postgres dentro del proceso (PGlite, sin servidor ni Docker),
 * aplica las migraciones de scripts/migrations/ en orden (000 → 009; la 010
 * crea un rol y es solo para psql, aquí se salta)
 * y expone un `sql` con la misma forma que el de @neondatabase/serverless:
 * tagged template que devuelve un arreglo de filas.
 *
 * Uso en una prueba:
 *   const t = await crearEntorno();          // base limpia + handlers
 *   const res = await t.llamar('citas', { method: 'POST', token, body });
 *
 * Este archivo no tiene pruebas propias; node --test lo carga y no hace nada.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.PIN_PEPPER = process.env.PIN_PEPPER || 'test-pin-pepper';

const MIGRACIONES = path.join(__dirname, '../../scripts/migrations');

/** Tagged template estilo neon() sobre PGlite, con sql.query y sql.transaction. */
function crearSql(db) {
  async function sql(strings, ...values) {
    let texto = strings[0];
    values.forEach((_, i) => { texto += `$${i + 1}${strings[i + 1]}`; });
    const r = await db.query(texto, values);
    return r.rows;
  }
  // Como en neon: sql.query() se puede esperar sola o pasar a transaction(),
  // que las corre todo o nada.
  sql.query = (texto, params = []) => ({
    texto, params, then: (ok, mal) => db.query(texto, params).then((r) => r.rows).then(ok, mal),
  });
  sql.transaction = (consultas) => db.transaction(async (tx) => {
    const resultados = [];
    for (const { texto, params } of consultas) resultados.push((await tx.query(texto, params)).rows);
    return resultados;
  });
  return sql;
}

let sqlActual = null;

// lib/db.js se sustituye ANTES de cargar cualquier handler: cada
// `require('../lib/db')` de api/ recibe este getSql.
require.cache[require.resolve('../../lib/db')] = {
  id: require.resolve('../../lib/db'),
  filename: require.resolve('../../lib/db'),
  loaded: true,
  exports: { getSql: () => sqlActual },
};

async function crearEntorno() {
  const db = new PGlite();
  const archivos = fs.readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    const texto = fs.readFileSync(path.join(MIGRACIONES, f), 'utf8');
    // Las de roles son scripts de psql (\getenv, \gexec): no cambian tablas.
    if (/^\\/m.test(texto)) continue;
    await db.exec(texto);
  }
  const sql = crearSql(db);
  sqlActual = sql;

  /** Llama un handler de api/ como lo haría Vercel. */
  async function llamar(endpoint, { method = 'GET', token, body, query = {}, headers = {} } = {}) {
    const handler = require(path.join(__dirname, '../../api', `${endpoint}.js`));
    const req = {
      method,
      query,
      body,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    await handler(req, res);
    return res;
  }

  return { db, sql, llamar, cerrar: () => db.close() };
}

module.exports = { crearEntorno };
