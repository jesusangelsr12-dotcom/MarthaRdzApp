/**
 * Pruebas de lib/validate.js: son la única barrera contra datos con forma
 * inválida en la API (montos negativos, fechas mal formadas, etc.).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDateStr, isFiniteNumber, isNonEmptyString, isMetodoPago, isTimeStr, isEstadoAgenda, isPinStr, isTelefonoStr, isUuid } = require('../lib/validate');

test('isDateStr acepta YYYY-MM-DD y rechaza el resto', () => {
  assert.equal(isDateStr('2026-09-13'), true);
  assert.equal(isDateStr('2026-9-13'), false);
  assert.equal(isDateStr('13/09/2026'), false);
  assert.equal(isDateStr(''), false);
  assert.equal(isDateStr(null), false);
  assert.equal(isDateStr(20260913), false);
});

test('isFiniteNumber respeta min/max y rechaza NaN/Infinity', () => {
  assert.equal(isFiniteNumber(50, { min: 0, max: 100 }), true);
  assert.equal(isFiniteNumber(-1, { min: 0 }), false);
  assert.equal(isFiniteNumber(101, { max: 100 }), false);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber('50'), true); // Number('50') es finito — igual que antes de esta validación
});

test('isNonEmptyString rechaza vacíos, solo-espacios y strings muy largos', () => {
  assert.equal(isNonEmptyString('Ana', 10), true);
  assert.equal(isNonEmptyString('', 10), false);
  assert.equal(isNonEmptyString('   ', 10), false);
  assert.equal(isNonEmptyString('a'.repeat(11), 10), false);
  assert.equal(isNonEmptyString(123, 10), false);
});

test('isMetodoPago solo acepta los tres métodos soportados', () => {
  assert.equal(isMetodoPago('Efectivo'), true);
  assert.equal(isMetodoPago('Tarjeta'), true);
  assert.equal(isMetodoPago('Transferencia'), true);
  assert.equal(isMetodoPago('Bitcoin'), false);
  assert.equal(isMetodoPago(''), false);
});

test('isTimeStr acepta HH:MM en 24h y rechaza el resto', () => {
  assert.equal(isTimeStr('00:00'), true);
  assert.equal(isTimeStr('23:59'), true);
  assert.equal(isTimeStr('09:05'), true);
  assert.equal(isTimeStr('24:00'), false);
  assert.equal(isTimeStr('9:05'), false);
  assert.equal(isTimeStr('12:60'), false);
  assert.equal(isTimeStr('12:00:00'), false);
  assert.equal(isTimeStr(''), false);
  assert.equal(isTimeStr(null), false);
});

test('isEstadoAgenda solo acepta los cuatro estados soportados', () => {
  assert.equal(isEstadoAgenda('pendiente'), true);
  assert.equal(isEstadoAgenda('completada'), true);
  assert.equal(isEstadoAgenda('no_asistio'), true);
  assert.equal(isEstadoAgenda('cancelada'), true);
  assert.equal(isEstadoAgenda('en_proceso'), false);
  assert.equal(isEstadoAgenda(''), false);
});

test('isPinStr solo acepta exactamente 6 dígitos', () => {
  assert.equal(isPinStr('123456'), true);
  assert.equal(isPinStr('000000'), true);
  assert.equal(isPinStr('12345'), false);
  assert.equal(isPinStr('1234567'), false);
  assert.equal(isPinStr('12345a'), false);
  assert.equal(isPinStr(123456), false);
  assert.equal(isPinStr(''), false);
  assert.equal(isPinStr(null), false);
});

test('isTelefonoStr acepta 10 dígitos o vacío (opcional), rechaza el resto', () => {
  assert.equal(isTelefonoStr('4421234567'), true);
  assert.equal(isTelefonoStr(''), true);
  assert.equal(isTelefonoStr('442123456'), false);
  assert.equal(isTelefonoStr('44212345678'), false);
  assert.equal(isTelefonoStr('442-123-4567'), false);
  assert.equal(isTelefonoStr('442123456a'), false);
  assert.equal(isTelefonoStr(4421234567), false);
  assert.equal(isTelefonoStr(null), false);
});

test('isUuid acepta un uuid en texto y rechaza el resto', () => {
  assert.equal(isUuid('8598973b-f64e-4b67-abb3-cb8ba59513bc'), true);
  assert.equal(isUuid('8598973B-F64E-4B67-ABB3-CB8BA59513BC'), true);
  assert.equal(isUuid('8598973b-f64e-4b67-abb3-cb8ba59513b'), false);
  assert.equal(isUuid('no-es-uuid'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(123), false);
});
