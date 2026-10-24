#!/usr/bin/env node
/**
 * Regresa un respaldo de Google Drive (marthardz-respaldo-AAAA-MM-DD.json.gz)
 * a una base de Neon. Pasos completos en docs/Deployment.md §8.
 *
 *   node scripts/restaurar-respaldo.js respaldo.json.gz              → solo lo revisa
 *   node scripts/restaurar-respaldo.js respaldo.json.gz --restaurar  → lo carga
 *
 * Usa DATABASE_URL (en .env o en la terminal), que debe apuntar a un branch
 * NUEVO de Neon creado «solo esquema» (sin datos), con las migraciones hasta
 * la del respaldo. Nunca pisa datos: si alguna tabla ya tiene filas, no hace
 * nada. Carga todo en una sola transacción: o entra completo o no entra nada.
 * Ya cargado, se revisa en ese branch y, si está bien, se vuelve el principal.
 */

const fs = require('fs');
const path = require('path');
const { leerArchivo, restaurar, contarFilas } = require('../lib/respaldo');

// ---- Carga sencilla de .env (sin dependencias, igual que crear-salon.js) --
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fallar(mensaje) {
  console.error(`❌ ${mensaje}`);
  process.exit(1);
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const ruta = argv.find((a) => !a.startsWith('--'));
  const cargar = argv.includes('--restaurar');
  if (!ruta) fallar('Uso: node scripts/restaurar-respaldo.js respaldo.json.gz [--restaurar]');
  if (!fs.existsSync(ruta)) fallar(`No existe el archivo ${ruta}`);

  let datos;
  try {
    datos = leerArchivo(fs.readFileSync(ruta));
  } catch (e) {
    fallar(e.message);
  }
  console.log(`Respaldo del ${datos.creado_at} · migración ${datos.migracion} · ${contarFilas(datos).toLocaleString('es-MX')} registros`);
  for (const t of datos.orden) console.log(`  ${t.padEnd(24)} ${String(datos.tablas[t].length).padStart(6)}`);
  console.log(`  (no van en el respaldo: ${datos.omitidas.join(', ')})`);

  if (!cargar) {
    console.log('\nSolo se revisó. Para cargarlo agrega --restaurar (DATABASE_URL de un branch nuevo «solo esquema»).');
    return;
  }
  if (!process.env.DATABASE_URL) fallar('Falta DATABASE_URL (en .env o en la terminal).');
  const { neon } = require('@neondatabase/serverless');
  const host = new URL(process.env.DATABASE_URL).host;
  console.log(`\nCargando en ${host}…`);
  try {
    const r = await restaurar(neon(process.env.DATABASE_URL), datos);
    console.log(`✅ Listo: ${r.filas.toLocaleString('es-MX')} registros en ${r.tablas} tablas.`);
  } catch (e) {
    fallar(e.message);
  }
}

main();
