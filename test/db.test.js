/**
 * Pruebas de lib/db.js: con qué rol y por dónde se conecta la app.
 * Si esto falla, la app entraría a Neon como el rol dueño (puede borrar
 * tablas) o no entraría. Ningún valor aquí es una credencial real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { urlDeConexion, ROL_APP } = require('../lib/db');

// Forma de la DATABASE_URL que pone la integración Neon ↔ Vercel.
const DE_LA_INTEGRACION = 'postgresql://neondb_owner:clave-del-duenio@ep-ejemplo-123456.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require';

test('con APP_DB_PASSWORD entra como app_runtime, nunca como el dueño', () => {
  const url = new URL(urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, APP_DB_PASSWORD: 'Abc-123_xyz', VERCEL_ENV: 'production' }));
  assert.equal(ROL_APP, 'app_runtime');
  assert.equal(url.username, 'app_runtime');
  assert.equal(url.password, 'Abc-123_xyz');
  assert.ok(!url.href.includes('clave-del-duenio'));
});

test('conserva la base y usa el host -pooler del mismo endpoint', () => {
  const url = new URL(urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, APP_DB_PASSWORD: 'x', VERCEL_ENV: 'preview' }));
  assert.equal(url.hostname, 'ep-ejemplo-123456-pooler.c-7.us-east-2.aws.neon.tech');
  assert.equal(url.pathname, '/neondb');
});

test('si la DATABASE_URL ya es -pooler no lo duplica', () => {
  const pooled = DE_LA_INTEGRACION.replace('123456.', '123456-pooler.');
  const url = new URL(urlDeConexion({ DATABASE_URL: pooled, APP_DB_PASSWORD: 'x', VERCEL_ENV: 'production' }));
  assert.equal(url.hostname, 'ep-ejemplo-123456-pooler.c-7.us-east-2.aws.neon.tech');
});

test('exige sslmode=require y channel_binding=require', () => {
  const sinSsl = DE_LA_INTEGRACION.replace('?sslmode=require', '?sslmode=prefer');
  const url = new URL(urlDeConexion({ DATABASE_URL: sinSsl, APP_DB_PASSWORD: 'x', VERCEL_ENV: 'production' }));
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('channel_binding'), 'require');
});

test('una contraseña con + / = sobrevive a la URL', () => {
  const url = new URL(urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, APP_DB_PASSWORD: 'a+b/c=d', VERCEL_ENV: 'production' }));
  assert.equal(decodeURIComponent(url.password), 'a+b/c=d');
});

test('en Production o Preview sin APP_DB_PASSWORD no se conecta (no cae al dueño)', () => {
  for (const VERCEL_ENV of ['production', 'preview']) {
    assert.throws(() => urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, VERCEL_ENV }), /APP_DB_PASSWORD/);
  }
});

test('el error no lleva ninguna parte de la conexión', () => {
  try {
    urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, VERCEL_ENV: 'production' });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.ok(!e.message.includes('clave-del-duenio'));
    assert.ok(!e.message.includes('neon.tech'));
  }
});

test('en local sin APP_DB_PASSWORD usa la DATABASE_URL de .env tal cual', () => {
  assert.equal(urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION, VERCEL_ENV: 'development' }), DE_LA_INTEGRACION);
  assert.equal(urlDeConexion({ DATABASE_URL: DE_LA_INTEGRACION }), DE_LA_INTEGRACION);
});

test('fuera de Neon no le inventa un host -pooler', () => {
  const url = new URL(urlDeConexion({ DATABASE_URL: 'postgresql://u:p@localhost:5432/neondb', APP_DB_PASSWORD: 'x' }));
  assert.equal(url.hostname, 'localhost');
});

test('sin DATABASE_URL avisa en vez de conectar a ciegas', () => {
  assert.throws(() => urlDeConexion({ APP_DB_PASSWORD: 'x', VERCEL_ENV: 'production' }), /DATABASE_URL/);
});
