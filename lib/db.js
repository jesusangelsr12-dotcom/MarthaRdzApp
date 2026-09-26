/**
 * Cliente Postgres (Neon, driver HTTP) para las serverless functions.
 * Cada `sql` es una request HTTPS — no hay pool que gestionar, ideal para
 * funciones de Vercel de vida corta.
 */

const { neon } = require('@neondatabase/serverless');

let sql = null;

function getSql() {
  if (sql) return sql;
  sql = neon(process.env.DATABASE_URL);
  return sql;
}

module.exports = { getSql };
