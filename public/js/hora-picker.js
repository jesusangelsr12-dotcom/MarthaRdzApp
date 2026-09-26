/**
 * Selector de hora simplificado: horas 1–12 + AM/PM, minutos solo de 10 en
 * 10 (00/10/20/30/40/50) — casi nunca se agenda al minuto exacto, así que
 * el selector nativo con sus 1440 combinaciones era más lento de usar que
 * elegir entre 3 listas cortas.
 *
 * Trabaja siempre en "HH:MM" 24h (lo que ya espera el backend/isTimeStr) —
 * la conversión a 12h + AM/PM es solo de despliegue.
 */

const MINUTOS = ['00', '10', '20', '30', '40', '50'];

/** "HH:MM" (24h) → { hora12, minuto, ampm }. Sin valor, hora por default
 * 9:00 AM. Un minuto que no sea múltiplo de 10 (agendado antes de este
 * cambio) se redondea al más cercano para no dejar el selector "vacío". */
function parse24h(horaStr) {
  if (!horaStr || !/^\d{2}:\d{2}$/.test(horaStr)) return { hora12: 9, minuto: '00', ampm: 'AM' };

  const [hStr, mStr] = horaStr.split(':');
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hora12 = h % 12;
  if (hora12 === 0) hora12 = 12;

  const mNum = parseInt(mStr, 10) || 0;
  const minuto = MINUTOS.reduce((closest, m) =>
    Math.abs(parseInt(m, 10) - mNum) < Math.abs(parseInt(closest, 10) - mNum) ? m : closest
  , '00');

  return { hora12, minuto, ampm };
}

function to24h(hora12, minuto, ampm) {
  let h = hora12 % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${minuto}`;
}

/** HTML del picker (3 selects: hora, minuto, AM/PM). `id` debe ser único
 * en la pantalla — de ahí salen los ids de cada select interno. */
export function renderHoraPicker(id, valorActual) {
  const { hora12, minuto, ampm } = parse24h(valorActual);
  const horas = Array.from({ length: 12 }, (_, i) => i + 1);

  return `
    <div class="hora-picker" id="${id}">
      <select class="input hora-picker-select" id="${id}-h" aria-label="Hora">
        ${horas.map((h) => `<option value="${h}" ${h === hora12 ? 'selected' : ''}>${h}</option>`).join('')}
      </select>
      <span class="hora-picker-colon">:</span>
      <select class="input hora-picker-select" id="${id}-m" aria-label="Minutos">
        ${MINUTOS.map((m) => `<option value="${m}" ${m === minuto ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <select class="input hora-picker-select hora-picker-ampm" id="${id}-ampm" aria-label="AM o PM">
        <option value="AM" ${ampm === 'AM' ? 'selected' : ''}>AM</option>
        <option value="PM" ${ampm === 'PM' ? 'selected' : ''}>PM</option>
      </select>
    </div>
  `;
}

/** Valor actual del picker ya insertado en el DOM, como "HH:MM" 24h. */
export function getHoraPickerValue(id) {
  const h = document.getElementById(`${id}-h`);
  const m = document.getElementById(`${id}-m`);
  const ampm = document.getElementById(`${id}-ampm`);
  if (!h || !m || !ampm) return '';
  return to24h(parseInt(h.value, 10), m.value, ampm.value);
}
