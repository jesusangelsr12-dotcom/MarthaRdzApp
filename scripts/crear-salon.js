#!/usr/bin/env node
/**
 * Crear un nuevo salón
 * ---------------------
 * Inserta un salón nuevo en la base de datos (tabla `salones`) y,
 * opcionalmente, copia el catálogo de servicios / productos / trabajadoras
 * de un salón ya existente para que el nuevo "traiga las mismas
 * configuraciones".
 *
 * Uso:
 *   node scripts/crear-salon.js --nombre "Testing"
 *   node scripts/crear-salon.js --nombre "Testing" --pin 123456
 *   node scripts/crear-salon.js --nombre "Testing" --pin 123456 --plantilla salon_001
 *
 * Flags:
 *   --nombre      Nombre del salón (obligatorio).
 *   --pin         PIN de 6 dígitos para poder iniciar sesión. Si se omite,
 *                 el salón se crea SIN PIN (no se podrá entrar hasta asignarlo).
 *   --plantilla   salon_id de un salón existente del cual copiar
 *                 servicios / productos / trabajadoras. Si se omite, el salón
 *                 se crea con catálogos vacíos. De las trabajadoras se copia
 *                 solo el nombre, nunca su PIN: un PIN repetido entre salones
 *                 haría que el login entrara al salón equivocado.
 *
 * El PIN se rechaza si ya lo usa otra dueña o trabajadora (de cualquier
 * salón), por la misma razón.
 *
 * Requiere las mismas variables de entorno que la app:
 *   DATABASE_URL
 *   PIN_PEPPER   (solo si se usa --pin; debe ser igual al de producción)
 * (se leen de las variables de entorno o de un archivo .env en la raíz).
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

// ---- Carga sencilla de .env (sin dependencias) --------------------------
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
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

// ---- Parseo de argumentos ------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const nombre = args.nombre;
  if (!nombre || nombre === true) {
    console.error('❌ Falta --nombre. Ej: node scripts/crear-salon.js --nombre "Testing" --pin 123456');
    process.exit(1);
  }

  const pin = args.pin && args.pin !== true ? String(args.pin) : null;
  if (pin && !/^\d{6}$/.test(pin)) {
    console.error('❌ El --pin debe ser de 6 dígitos numéricos.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL en el entorno / .env');
    process.exit(1);
  }
  if (pin && !process.env.PIN_PEPPER) {
    console.error('❌ Falta PIN_PEPPER en el entorno / .env (debe ser el mismo que usa la app en producción).');
    process.exit(1);
  }
  // Requiere lib/auth.js para no duplicar la fórmula del hash (con pepper)
  // en un tercer lugar además de api/login.js.
  const { pepperedPinHash, pinEnUso } = require('../lib/auth');
  const sql = neon(process.env.DATABASE_URL);

  // 0. El login busca el PIN sin pedir salón: no puede repetirse
  if (pin && await pinEnUso(sql, pin)) {
    console.error('❌ Ese PIN ya lo usa otra dueña o trabajadora. Elige otro.');
    process.exit(1);
  }

  // 1. Leer salones existentes → siguiente salon_id
  console.log('→ Leyendo salones existentes…');
  const existentes = await sql`select salon_id from salones`;

  let maxNum = 0;
  for (const row of existentes) {
    const m = /^salon_(\d+)$/.exec((row.salon_id || '').trim());
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const salonId = `salon_${String(maxNum + 1).padStart(3, '0')}`;

  // 2. Resolver catálogos desde una plantilla (opcional)
  let servicios = [];
  let productos = [];
  let trabajadoras = [];
  if (args.plantilla && args.plantilla !== true) {
    console.log(`→ Copiando catálogo desde plantilla ${args.plantilla}…`);
    const rows = await sql`
      select servicios, productos, trabajadoras from salones where salon_id = ${args.plantilla}
    `;
    const plantilla = rows[0];
    if (plantilla) {
      servicios = plantilla.servicios || [];
      productos = plantilla.productos || [];
      // Solo el nombre: el PIN de cada trabajadora es personal y único.
      trabajadoras = (plantilla.trabajadoras || []).map((t) => ({ nombre: t.nombre }));
    }
    console.log(`   Servicios: ${servicios.length} · Productos: ${productos.length} · Trabajadoras: ${trabajadoras.length}`);
  }

  // 3. Insertar el salón
  console.log(`→ Creando salón "${nombre}"…`);
  const inserted = await sql`
    insert into salones (salon_id, nombre, pin_hash, pin_hash_v2, servicios, productos, trabajadoras)
    values (
      ${salonId},
      ${nombre},
      '',
      ${pin ? pepperedPinHash(pin) : null},
      ${JSON.stringify(servicios)}::jsonb,
      ${JSON.stringify(productos)}::jsonb,
      ${JSON.stringify(trabajadoras)}::jsonb
    )
    returning id
  `;

  // 4. Resumen
  console.log('\n✅ Salón creado correctamente');
  console.log('────────────────────────────');
  console.log(`  salon_id : ${salonId}`);
  console.log(`  nombre   : ${nombre}`);
  console.log(`  id       : ${inserted[0].id}`);
  if (pin) {
    console.log(`  PIN      : ${pin}  (ya puedes iniciar sesión en la app)`);
  } else {
    console.log('  PIN      : (sin asignar) — vuelve a correr el script con --pin 123456 para asignarlo');
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
