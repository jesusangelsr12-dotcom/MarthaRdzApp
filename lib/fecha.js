/**
 * Fechas en la zona horaria de los salones (Ciudad de México).
 *
 * El servidor corre en UTC. `new Date().toISOString().slice(0, 10)` da la
 * fecha de UTC, que entre las 18:00 y las 23:59 de México ya es "mañana":
 * un anticipo cobrado a las 7 pm quedaba registrado en el día siguiente.
 * Todo lo que el servidor fecha por su cuenta usa esto.
 */

const ZONA_SALON = 'America/Mexico_City';

/** "YYYY-MM-DD" de hoy (o de hoy + offsetDias) en México. `ahora` es para pruebas. */
function fechaMexico(offsetDias = 0, ahora = new Date()) {
  const hoyStr = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_SALON }).format(ahora);
  if (!offsetDias) return hoyStr;
  // Mediodía UTC: sumar días nunca cruza un cambio de fecha por la hora.
  const d = new Date(`${hoyStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

module.exports = { fechaMexico, ZONA_SALON };
