/**
 * Validación de entrada compartida por las serverless functions.
 * Todo esto es frontera pública (la API la puede llamar cualquiera con un
 * token válido): antes solo se validaba que los campos existieran, nunca
 * su forma real.
 */

const METODOS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia'];

function isDateStr(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isFiniteNumber(v, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

function isNonEmptyString(v, maxLen = 500) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function isMetodoPago(v) {
  return METODOS_PAGO.includes(v);
}

function isTimeStr(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

const ESTADOS_AGENDA = ['pendiente', 'completada', 'no_asistio', 'cancelada'];

function isEstadoAgenda(v) {
  return ESTADOS_AGENDA.includes(v);
}

function isPinStr(v) {
  return typeof v === 'string' && /^\d{6}$/.test(v);
}

/** Celular mexicano a 10 dígitos, sin el 52 de país (se antepone al armar
 * el link de WhatsApp, no al guardar). Vacío también es válido: el campo
 * es opcional. */
function isTelefonoStr(v) {
  return typeof v === 'string' && (v === '' || /^\d{10}$/.test(v));
}

/** uuid en su forma de texto (8-4-4-4-12 hex). Un id mal formado llegaba
 * hasta Postgres y tronaba con un 500 en vez de un 400. */
function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

module.exports = {
  isUuid,
  METODOS_PAGO,
  isDateStr,
  isFiniteNumber,
  isNonEmptyString,
  isMetodoPago,
  isTimeStr,
  ESTADOS_AGENDA,
  isEstadoAgenda,
  isPinStr,
  isTelefonoStr,
};
