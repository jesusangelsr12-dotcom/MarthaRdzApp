/**
 * `normalizeNombre` vive duplicada a propósito en api/clientas.js (CommonJS)
 * y public/js/utils.js (ESM) — son runtimes distintos (servidor vs
 * navegador) y este proyecto no tiene paso de build para compartir un
 * único módulo entre ambos. Esta prueba es la red de seguridad: si alguien
 * cambia una copia y no la otra, esto lo revienta en vez de dejar que dos
 * clientas con el mismo nombre terminen agrupadas distinto en cada lado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Carga normalizeNombre desde public/js/utils.js sin un bundler ESM real. */
function loadFrontendNormalize() {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/utils.js'), 'utf8');
  const match = /export function normalizeNombre\([\s\S]*?\n}/.exec(src);
  assert.ok(match, 'no se encontró normalizeNombre en public/js/utils.js — ¿cambió de nombre o de firma?');
  const fnSrc = match[0].replace('export function', 'function');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fnSrc}\nthis.normalizeNombre = normalizeNombre;`, sandbox);
  return sandbox.normalizeNombre;
}

/** Carga normalizeNombre desde api/clientas.js (CommonJS, se puede requerir directo). */
function loadBackendNormalize() {
  // api/clientas.js no exporta normalizeNombre (es interna), así que se
  // extrae del archivo igual que la del frontend en vez de tocar su API pública.
  const src = fs.readFileSync(path.join(__dirname, '../api/clientas.js'), 'utf8');
  const match = /function normalizeNombre\([\s\S]*?\n}/.exec(src);
  assert.ok(match, 'no se encontró normalizeNombre en api/clientas.js — ¿cambió de nombre o de firma?');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${match[0]}\nthis.normalizeNombre = normalizeNombre;`, sandbox);
  return sandbox.normalizeNombre;
}

test('normalizeNombre produce el mismo resultado en frontend y backend', () => {
  const frontend = loadFrontendNormalize();
  const backend = loadBackendNormalize();

  const casos = [
    'María López',
    'MARIA LOPEZ',
    '  maria   lopez  ',
    'Ñoño Peña',
    'José',
    '',
    null,
    undefined,
    'Ana-María  Núñez',
  ];

  for (const caso of casos) {
    assert.equal(frontend(caso), backend(caso), `difieren para input=${JSON.stringify(caso)}`);
  }
});
