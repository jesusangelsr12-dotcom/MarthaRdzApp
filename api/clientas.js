/**
 * GET/POST /api/clientas
 *
 * GET                → { clientas: ["Ana", ...], notas_fijas: { "ana": "..." },
 *                         telefonos: { "ana": "4421234567" } }
 * GET  ?historial=1  → { clientas: [{ nombre, key, nota_fija, telefono,
 *                                     total_visitas, total_gastado,
 *                                     ultima_visita, visitas: [...] }] }
 * POST { clienta, nota_fija, telefono } → { success }
 *
 * Requiere `Authorization: Bearer <token>`; el salón se toma del token
 * verificado, nunca de un sheet_id que mande el cliente.
 *
 * El modo historial devuelve todo de una sola llamada para que el buscador
 * filtre en el navegador sin round-trips por tecla.
 *
 * Una trabajadora solo puede usar el modo lista (nombres, para el
 * autocomplete al registrar una cita) y nunca recibe `notas_fijas` — ahí
 * viven alergias/preferencias. El teléfono tampoco (el permiso
 * "Teléfonos de clientas" se retiró con la Agenda en la v50). El modo
 * historial y el POST (nota fija y teléfono) son solo de la dueña.
 */

const { getSql } = require('../lib/db');
const { requireSession, getSessionRole } = require('../lib/auth');
const { isNonEmptyString, isTelefonoStr } = require('../lib/validate');
const { fechaMexico } = require('../lib/fecha');

/**
 * Clave para agrupar e identificar a una clienta.
 * El nombre es texto libre, así que "María", "maria" y "MARIA " deben ser la misma.
 * OJO: esta función está duplicada en public/js/utils.js (api es CommonJS y el
 * front es ESM, no comparten módulos). Si cambia una, cambiar la otra.
 */
function normalizeNombre(nombre) {
  return String(nombre || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);
  if (!salonId) return;
  const { role } = getSessionRole(req);

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const { historial } = req.query;

      if (historial && role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const [citasRows, clientasRows] = await Promise.all([
        // Se excluyen las filas de solo-anticipo (de la Agenda vieja, ver api/citas.js):
        // no son una visita real, y contarlas aquí infla el historial de la
        // clienta con una "cita" que en realidad fue solo un depósito.
        sql`
          select fecha::text as fecha, timestamp, clienta, items, total, metodo_pago, nota
          from citas
          where salon_id = ${salonId} and deleted_at is null
            and not (items @> '[{"tipo":"anticipo"}]'::jsonb)
        `,
        sql`select clienta, nota_fija, telefono from clientas where salon_id = ${salonId}`,
      ]);

      // --- Modo historial: todo agrupado por clienta ---
      if (historial) {
        // Notas fijas por clave normalizada
        const notas = {};
        for (const row of clientasRows) {
          const nombre = (row.clienta || '').trim();
          if (!nombre) continue;
          notas[normalizeNombre(nombre)] = { nombre, nota: row.nota_fija || '', telefono: row.telefono || '' };
        }

        const grupos = {};
        for (const row of citasRows) {
          const nombreRaw = row.clienta;
          if (!nombreRaw || !nombreRaw.trim()) continue;

          const key = normalizeNombre(nombreRaw);
          if (!grupos[key]) {
            grupos[key] = {
              nombre: nombreRaw.trim(),
              key,
              nota_fija: '',
              telefono: '',
              total_visitas: 0,
              total_gastado: 0,
              ultima_visita: '',
              visitas: [],
            };
          }

          const g = grupos[key];
          g.total_visitas += 1;
          g.total_gastado += Number(row.total);
          g.visitas.push({
            fecha: row.fecha,
            timestamp: row.timestamp,
            // Nombre EXACTO de la cita: es lo que el PATCH necesita para
            // localizarla. No normalizar ni recortar.
            clienta_raw: nombreRaw,
            items: row.items,
            total: Number(row.total),
            metodo_pago: row.metodo_pago,
            nota: row.nota || '',
          });
        }

        const clientas = Object.values(grupos).map((g) => {
          // Más reciente primero
          g.visitas.sort((a, b) =>
            (b.fecha || '').localeCompare(a.fecha || '') ||
            (b.timestamp || '').localeCompare(a.timestamp || '')
          );
          g.ultima_visita = g.visitas.length > 0 ? g.visitas[0].fecha : '';
          // La grafía preferida es la que la usuaria escribió en Clientas;
          // si no hay, la de la visita más reciente.
          const fija = notas[g.key];
          if (fija) {
            g.nota_fija = fija.nota;
            g.telefono = fija.telefono;
            g.nombre = fija.nombre;
          } else if (g.visitas.length > 0) {
            g.nombre = (g.visitas[0].clienta_raw || '').trim();
          }
          return g;
        });

        // Clientas con nota fija pero sin ninguna cita todavía
        for (const [key, fija] of Object.entries(notas)) {
          if (grupos[key]) continue;
          clientas.push({
            nombre: fija.nombre,
            key,
            nota_fija: fija.nota,
            telefono: fija.telefono,
            total_visitas: 0,
            total_gastado: 0,
            ultima_visita: '',
            visitas: [],
          });
        }

        clientas.sort((a, b) => (b.ultima_visita || '').localeCompare(a.ultima_visita || ''));
        return res.status(200).json({ clientas });
      }

      // --- Modo lista: nombres únicos (lo usa el autocomplete de la cita) ---
      const names = new Set();
      for (const row of citasRows) {
        const name = (row.clienta || '').trim();
        if (name) names.add(name);
      }

      // Notas fijas y teléfono para poder avisar de alergias / mandar
      // WhatsApp sin una llamada extra
      const notas_fijas = {};
      const telefonos = {};
      for (const row of clientasRows) {
        const nombre = (row.clienta || '').trim();
        if (!nombre) continue;
        names.add(nombre);
        if (row.nota_fija) notas_fijas[normalizeNombre(nombre)] = row.nota_fija;
        if (row.telefono) telefonos[normalizeNombre(nombre)] = row.telefono;
      }

      return res.status(200).json({
        clientas: [...names].sort(),
        // Alergias/preferencias y teléfono son "detalle de clientas" —
        // fuera del alcance de una trabajadora, aunque el nombre sí lo
        // necesite.
        notas_fijas: role === 'trabajadora' ? {} : notas_fijas,
        telefonos: role === 'trabajadora' ? {} : telefonos,
      });
    }

    if (req.method === 'POST') {
      if (role === 'trabajadora') {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso a esto' });
      }

      const { clienta, nota_fija, telefono } = req.body || {};

      if (!isNonEmptyString(clienta, 200)) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
      }

      // Vaciar la nota es válido
      if (typeof nota_fija !== 'string' || nota_fija.length > 2000) {
        return res.status(400).json({ error: 'Nota inválida' });
      }
      if (!isTelefonoStr(telefono)) {
        return res.status(400).json({ error: 'Teléfono inválido — deben ser 10 dígitos' });
      }

      const nombre = String(clienta).trim();
      const hoy = fechaMexico();

      // Se manda el estado completo del registro en cada guardado (el
      // editor de nota fija y el de teléfono ya tienen ambos valores en
      // memoria) — evita lógica de actualización parcial por columna.
      await sql`
        insert into clientas (salon_id, clienta, clienta_normalizada, nota_fija, telefono, actualizado)
        values (${salonId}, ${nombre}, ${normalizeNombre(nombre)}, ${nota_fija}, ${telefono}, ${hoy})
        on conflict (salon_id, clienta_normalizada)
        do update set clienta = excluded.clienta, nota_fija = excluded.nota_fija, telefono = excluded.telefono, actualizado = excluded.actualizado
      `;

      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en clientas:', error);
    res.status(500).json({ error: 'Error al procesar clientas' });
  }
};
