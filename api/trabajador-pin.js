/**
 * POST /api/trabajador-pin
 * Da, cambia o quita el PIN de acceso de una trabajadora ya existente en
 * el catálogo (`salones.trabajadoras`). Exclusivo de la dueña.
 *
 * Body: { nombre, pin }          → asigna/cambia su PIN de 6 dígitos
 *       { nombre, remove: true } → le quita el acceso (conserva el nombre
 *                                  para comisiones, solo borra `pin_hash`)
 *       { nombre, permisos: { telefonos: true|false } }
 *                                → qué más puede hacer en la app (ver
 *                                  PERMISOS_TRABAJADORA en lib/auth.js).
 *                                  Todos arrancan apagados.
 *
 * El PIN se guarda con el mismo hash con pepper que el de la dueña
 * (`pepperedPinHash`), dentro del mismo jsonb de `trabajadoras` — sin
 * tabla ni columna nueva. El hash nunca se devuelve al cliente.
 *
 * Quitar el acceso borra también sus dispositivos con Face ID/Touch ID:
 * sin eso podía seguir entrando con biometría aunque ya no tuviera PIN.
 *
 * Requiere `Authorization: Bearer <token>` de la DUEÑA (requireOwnerSession).
 */

const { getSql } = require('../lib/db');
const { requireOwnerSession, pepperedPinHash, pinEnUso, PERMISOS_TRABAJADORA, normalizarPermisos } = require('../lib/auth');
const { isNonEmptyString, isPinStr } = require('../lib/validate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const salonId = requireOwnerSession(req, res);
  if (!salonId) return;

  try {
    const { nombre, pin, remove, permisos } = req.body || {};
    const cambiaPermisos = permisos !== undefined;

    if (!isNonEmptyString(nombre, 200)) {
      return res.status(400).json({ error: 'Falta el nombre de la trabajadora' });
    }
    if (cambiaPermisos && (
      !permisos || typeof permisos !== 'object' || Array.isArray(permisos) ||
      !Object.entries(permisos).every(([k, v]) => PERMISOS_TRABAJADORA.includes(k) && typeof v === 'boolean')
    )) {
      return res.status(400).json({ error: 'Permisos inválidos' });
    }
    if (!cambiaPermisos && remove !== true && !isPinStr(pin)) {
      return res.status(400).json({ error: 'El PIN debe ser de 6 dígitos' });
    }

    const sql = getSql();

    const [salon] = await sql`select trabajadoras from salones where id = ${salonId}`;
    const trabajadoras = salon?.trabajadoras || [];
    if (!trabajadoras.some((t) => t.nombre === nombre)) {
      return res.status(404).json({ error: 'Esa trabajadora no existe — agrégala primero desde Configuración' });
    }

    if (cambiaPermisos) {
      const nuevas = trabajadoras.map((t) => (t.nombre === nombre
        ? { ...t, permisos: normalizarPermisos({ ...normalizarPermisos(t.permisos), ...permisos }) }
        : t));
      await sql`update salones set trabajadoras = ${JSON.stringify(nuevas)}::jsonb where id = ${salonId}`;
      const actualizada = nuevas.find((t) => t.nombre === nombre);
      return res.status(200).json({ success: true, permisos: actualizada.permisos });
    }

    if (remove === true) {
      const nuevas = trabajadoras.map((t) => {
        if (t.nombre !== nombre) return t;
        const { pin_hash, ...resto } = t;
        return resto;
      });
      await sql`update salones set trabajadoras = ${JSON.stringify(nuevas)}::jsonb where id = ${salonId}`;
      await sql`
        delete from webauthn_credentials
        where salon_id = ${salonId} and role = 'trabajadora' and worker = ${nombre}
      `;
      return res.status(200).json({ success: true });
    }

    if (await pinEnUso(sql, pin, { salonId, nombre })) {
      return res.status(409).json({ error: 'Ese PIN ya está en uso, elige otro' });
    }

    const peppered = pepperedPinHash(pin);
    const nuevas = trabajadoras.map((t) => (t.nombre === nombre ? { ...t, pin_hash: peppered } : t));
    await sql`update salones set trabajadoras = ${JSON.stringify(nuevas)}::jsonb where id = ${salonId}`;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error en trabajador-pin:', error);
    res.status(500).json({ error: 'Error al procesar el PIN de la trabajadora' });
  }
};
