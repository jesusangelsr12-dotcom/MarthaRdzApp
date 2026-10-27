/**
 * Cliente Postgres (Neon, driver HTTP) para las serverless functions.
 * Cada `sql` es una request HTTPS — no hay pool que gestionar, ideal para
 * funciones de Vercel de vida corta.
 *
 * La app entra como `app_runtime`: solo lee y escribe filas (migración
 * 010). La integración Neon ↔ Vercel pone DATABASE_URL con el rol dueño y,
 * en cada Preview, la de su propio branch; de ahí salen host y base, y se
 * cambian usuario y contraseña por app_runtime + APP_DB_PASSWORD. En
 * Production y Preview, sin APP_DB_PASSWORD no se conecta: nunca cae en
 * silencio al rol dueño.
 */

const { neon } = require('@neondatabase/serverless');

const ROL_APP = 'app_runtime';

let sql = null;

function urlDeConexion(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  if (!env.APP_DB_PASSWORD) {
    if (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') {
      throw new Error('Falta APP_DB_PASSWORD: la app no se conecta con el rol dueño');
    }
    return env.DATABASE_URL; // Local (vercel dev): la de .env tal cual
  }
  const url = new URL(env.DATABASE_URL);
  url.username = ROL_APP;
  url.password = env.APP_DB_PASSWORD;
  // Siempre por el pooler de Neon: ep-xxx → ep-xxx-pooler.
  const [endpoint, ...resto] = url.hostname.split('.');
  if (url.hostname.endsWith('.neon.tech') && !endpoint.endsWith('-pooler')) {
    url.hostname = [`${endpoint}-pooler`, ...resto].join('.');
  }
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('channel_binding', 'require');
  return url.toString();
}

function getSql() {
  if (sql) return sql;
  sql = neon(urlDeConexion());
  return sql;
}

module.exports = { getSql, urlDeConexion, ROL_APP };
