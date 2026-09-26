/**
 * Flujo "Agendar Cita"
 *
 * Reserva una cita futura: clienta + fecha + hora, anticipo opcional (con su
 * método de pago) y una nota. Al confirmar, si hay anticipo, ese dinero ya
 * queda registrado como ingreso de HOY (ver api/citas-agendadas.js) — el
 * resto se cobra el día de la cita, desde "Registrar Cita" tocando el
 * recuadro de esta clienta.
 *
 * Mismo armazón de pasos que cita.js (STEPS/goNext/goBack/puntitos), pero
 * más corto: no hay servicios/productos/comisiones aquí, eso se define hasta
 * el día de la cita.
 */

import { createCitaAgendada, getClientas, saveNotaFija } from '../api.js';
import { formatMXN, todayISO, nowTimestamp, showToast, showLoader, hideLoader, escapeHTML, normalizeNombre, METODOS_PAGO, formatFechaLarga, formatHora12 } from '../utils.js';
import { navigateTo } from '../app.js';
import { isTrabajadora } from '../auth.js';
import { renderHoraPicker, getHoraPickerValue } from '../hora-picker.js';

let session = null;
let stepKey = 'clienta';
let allClientas = [];
let notasFijas = {};
let telefonos = {};      // { claveNormalizada: telefono } para prellenar el campo
let telefonoOriginal = ''; // el que ya traía la clienta al elegirla

/** Agenda manda la fecha elegida como "#agendar?fecha=2026-10-02" (en vez
 * de una variable compartida entre módulos) — así siempre se lee fresca
 * del hash actual sin importar cuántas veces se dispare init(), y sigue
 * funcionando si la usuaria recarga la página a medio camino. */
function fechaDesdeHash() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  return new URLSearchParams(hash.slice(qIndex + 1)).get('fecha');
}

let agenda = {
  clienta: '',
  fecha: '',
  hora: '',
  telefono: '',
  anticipo: '',
  anticipoMetodoPago: '',
  nota: '',
};

let currentAnticipo = '';
let enviandoAgenda = false;

const STEPS = ['clienta', 'anticipo', 'pago_anticipo', 'nota', 'confirmar'];

/** Pasos activos: "pago_anticipo" solo existe si hay anticipo. */
function activeSteps() {
  return STEPS.filter((k) => {
    if (k === 'pago_anticipo') return parseFloat(currentAnticipo || '0') > 0;
    return true;
  });
}

function goTo(key) {
  stepKey = key;
  renderStep();
}

function goNext() {
  const steps = activeSteps();
  const next = steps[steps.indexOf(stepKey) + 1];
  if (!next) return;
  goTo(next);
}

function goBack() {
  const steps = activeSteps();
  const prev = steps[steps.indexOf(stepKey) - 1];
  if (!prev) {
    navigateTo('agenda');
    return;
  }
  goTo(prev);
}

/** "2026-09-20" → "20 de septiembre de 2026" */
function formatFechaDisplay(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function render(s) {
  session = s;
  const totalSteps = activeSteps().length;
  return `
    <div class="screen" id="agendar-screen">
      <header class="screen-header">
        <button class="header-back" id="agendar-back">← Atrás</button>
        <h2 class="screen-title">Agendar Cita</h2>
      </header>

      <div class="step-indicator" id="step-indicator">
        ${Array.from({ length: totalSteps }, () => '<div class="step-dot"></div>').join('')}
      </div>

      <div id="agendar-step-content"></div>
    </div>
  `;
}

export function init(s) {
  session = s;
  stepKey = 'clienta';
  const fechaHash = fechaDesdeHash();
  const fechaInicial = /^\d{4}-\d{2}-\d{2}$/.test(fechaHash || '') ? fechaHash : todayISO();
  agenda = { clienta: '', fecha: fechaInicial, hora: '', telefono: '', anticipo: '', anticipoMetodoPago: '', nota: '' };
  currentAnticipo = '';
  enviandoAgenda = false;
  allClientas = [];
  notasFijas = {};
  telefonos = {};
  telefonoOriginal = '';

  document.getElementById('agendar-back').addEventListener('click', goBack);
  renderStep();

  if (session?.sheet_id) {
    getClientas(session.sheet_id)
      .then((res) => {
        allClientas = res.clientas || [];
        notasFijas = res.notas_fijas || {};
        telefonos = res.telefonos || {};
      })
      .catch(() => { /* silencioso */ });
  }
}

/** Prellena el teléfono con el que ya tiene guardado esa clienta (si hay).
 * Guarda también el valor "original" para saber, al agendar, si hace
 * falta guardarlo de nuevo o se quedó igual. */
function aplicarTelefonoDeClienta(nombre) {
  const tel = telefonos[normalizeNombre(nombre)] || '';
  telefonoOriginal = tel;
  agenda.telefono = tel;
  const input = document.getElementById('input-telefono-clienta');
  if (input) input.value = tel;
}

function updateStepIndicator() {
  const activeIndex = activeSteps().indexOf(stepKey);
  const dots = document.querySelectorAll('#step-indicator .step-dot');
  dots.forEach((dot, i) => dot.classList.toggle('active', i <= activeIndex));
}

function renderStep() {
  updateStepIndicator();
  const container = document.getElementById('agendar-step-content');

  switch (stepKey) {
    case 'clienta': renderStepClienta(container); break;
    case 'anticipo': renderStepAnticipo(container); break;
    case 'pago_anticipo': renderStepPagoAnticipo(container); break;
    case 'nota': renderStepNota(container); break;
    case 'confirmar': renderStepConfirmar(container); break;
  }
}

// Paso "clienta": nombre (con autocomplete) + teléfono + fecha/hora de la cita
function renderStepClienta(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Nombre de la clienta</label>
      <div class="clienta-input-wrapper">
        <input type="text" class="input" id="input-clienta" placeholder="Ej: María López"
          value="${escapeHTML(agenda.clienta)}" autocomplete="off">
        <div class="clienta-suggestions hidden" id="clienta-suggestions"></div>
      </div>

      ${isTrabajadora() ? '' : `
        <label class="input-label mt-16">Teléfono (opcional)</label>
        <input type="tel" class="input" id="input-telefono-clienta" inputmode="numeric" maxlength="10"
          placeholder="10 dígitos" value="${escapeHTML(agenda.telefono)}" autocomplete="off">
      `}

      <label class="input-label mt-24">Fecha de la cita</label>
      <input type="date" class="date-picker-input" id="input-fecha" min="${todayISO()}"
        value="${agenda.fecha || todayISO()}">
      <p class="fecha-dia-semana" id="fecha-dia-semana">${formatFechaLarga(agenda.fecha || todayISO())}</p>

      <label class="input-label mt-24">Hora de la cita</label>
      ${renderHoraPicker('input-hora', agenda.hora)}

      <button class="btn btn-primary mt-24" id="btn-step-clienta">Siguiente</button>
    </div>
  `;

  const input = document.getElementById('input-clienta');
  const suggestionsEl = document.getElementById('clienta-suggestions');
  const fechaInput = document.getElementById('input-fecha');
  const fechaDiaSemanaEl = document.getElementById('fecha-dia-semana');
  const telefonoInput = document.getElementById('input-telefono-clienta');

  // No existe para una trabajadora — el teléfono es "detalle de clienta",
  // fuera de su alcance (ver api/clientas.js).
  if (telefonoInput) {
    telefonoInput.addEventListener('input', () => {
      telefonoInput.value = telefonoInput.value.replace(/\D/g, '').slice(0, 10);
    });
  }

  // El input nativo no dice a qué día de la semana corresponde la fecha —
  // este texto sí, y se actualiza en cuanto se elige otra.
  fechaInput.addEventListener('change', () => {
    fechaDiaSemanaEl.textContent = fechaInput.value ? formatFechaLarga(fechaInput.value) : '';
  });

  const advance = () => {
    const val = input.value.trim();
    if (!val) { showToast('Ingresa el nombre de la clienta', 'error'); return; }
    if (!fechaInput.value) { showToast('Selecciona la fecha de la cita', 'error'); return; }
    const telefono = telefonoInput ? telefonoInput.value.trim() : '';
    if (telefono && telefono.length !== 10) {
      showToast('El teléfono debe tener 10 dígitos', 'error');
      return;
    }
    agenda.clienta = val;
    agenda.fecha = fechaInput.value;
    agenda.hora = getHoraPickerValue('input-hora');
    agenda.telefono = telefono;
    goNext();
  };

  document.getElementById('btn-step-clienta').addEventListener('click', advance);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') advance(); });

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();

    // Si lo escrito ya coincide exacto con una clienta conocida, prellenar
    // su teléfono; si deja de coincidir, limpiarlo (a menos que ya se haya
    // editado a mano) para no dejarlo pegado a otra persona.
    const exactMatch = allClientas.find((name) => normalizeNombre(name) === normalizeNombre(input.value));
    if (exactMatch) {
      aplicarTelefonoDeClienta(exactMatch);
    } else if (telefonoInput && telefonoInput.value === telefonoOriginal) {
      telefonoOriginal = '';
      agenda.telefono = '';
      telefonoInput.value = '';
    }

    if (query.length < 2 || allClientas.length === 0) {
      suggestionsEl.classList.add('hidden');
      return;
    }
    const matches = allClientas.filter((name) => name.toLowerCase().includes(query)).slice(0, 5);
    if (matches.length === 0) {
      suggestionsEl.classList.add('hidden');
      return;
    }
    suggestionsEl.innerHTML = matches.map((name) =>
      `<button class="clienta-suggestion-item" type="button">${escapeHTML(name)}</button>`
    ).join('');
    suggestionsEl.classList.remove('hidden');
  });

  suggestionsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.clienta-suggestion-item');
    if (!item) return;
    input.value = item.textContent;
    agenda.clienta = item.textContent;
    aplicarTelefonoDeClienta(item.textContent);
    suggestionsEl.classList.add('hidden');
  });

  input.addEventListener('blur', () => {
    setTimeout(() => suggestionsEl.classList.add('hidden'), 200);
  });

  input.focus();
}

// Paso "anticipo": monto vía teclado numérico ($0 es válido: sin anticipo)
function renderStepAnticipo(el) {
  currentAnticipo = agenda.anticipo || '';

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">¿Cuánto dio de anticipo?</label>
      <p class="multi-select-hint">Si no dio anticipo, deja en $0 y continúa</p>
      <div class="amount-display">
        <span class="amount-display-currency">$</span>
        <span class="amount-display-value" id="anticipo-display">${currentAnticipo || '0'}</span>
      </div>
      <div class="keypad" id="anticipo-keypad">
        <button class="keypad-key" data-key="1">1</button>
        <button class="keypad-key" data-key="2">2</button>
        <button class="keypad-key" data-key="3">3</button>
        <button class="keypad-key" data-key="4">4</button>
        <button class="keypad-key" data-key="5">5</button>
        <button class="keypad-key" data-key="6">6</button>
        <button class="keypad-key" data-key="7">7</button>
        <button class="keypad-key" data-key="8">8</button>
        <button class="keypad-key" data-key="9">9</button>
        <button class="keypad-key keypad-key--delete" data-key="delete">⌫</button>
        <button class="keypad-key" data-key="0">0</button>
        <button class="keypad-key keypad-key--confirm" data-key="ok">✓</button>
      </div>
    </div>
  `;

  document.getElementById('anticipo-keypad').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (!key) return;
    const k = key.dataset.key;

    if (k === 'delete') {
      currentAnticipo = currentAnticipo.slice(0, -1);
    } else if (k === 'ok') {
      agenda.anticipo = currentAnticipo || '0';
      if (parseFloat(agenda.anticipo) === 0) agenda.anticipoMetodoPago = '';
      goNext();
      return;
    } else {
      if (currentAnticipo === '0') currentAnticipo = '';
      if (currentAnticipo.length < 7) currentAnticipo += k;
    }

    document.getElementById('anticipo-display').textContent = currentAnticipo || '0';
  });
}

// Paso "pago_anticipo": método de pago del anticipo (solo si hay anticipo)
function renderStepPagoAnticipo(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">¿Cómo pagó el anticipo?</label>
      <div class="payment-grid">
        ${METODOS_PAGO.map((m) => `
          <button class="payment-card ${agenda.anticipoMetodoPago === m.id ? 'selected' : ''}" data-metodo="${m.id}">
            <span class="payment-card-emoji">${m.emoji}</span>
            <span class="payment-card-label">${m.label}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  el.querySelector('.payment-grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-metodo]');
    if (!card) return;
    agenda.anticipoMetodoPago = card.dataset.metodo;
    goNext();
  });
}

// Paso "nota": qué tiene planeado hacer la clienta (opcional)
function renderStepNota(el) {
  const notaFija = notasFijas[normalizeNombre(agenda.clienta)] || '';

  el.innerHTML = `
    <div class="step-content">
      ${notaFija ? `
        <div class="nota-fija-banner">
          <span class="nota-fija-banner-label">Nota de ${escapeHTML(agenda.clienta)}</span>
          <span class="nota-fija-banner-text">${escapeHTML(notaFija)}</span>
        </div>
      ` : ''}

      <label class="input-label">Nota (opcional)</label>
      <p class="multi-select-hint">Ej: "quiere tinte + corte" — para tenerlo presente ese día</p>
      <textarea class="input textarea" id="input-nota" rows="4" maxlength="500"
        placeholder="Ej: Quiere tinte y corte">${escapeHTML(agenda.nota)}</textarea>
      <div class="char-counter" id="nota-counter">${agenda.nota.length}/500</div>

      <div class="step-actions mt-24">
        <button class="btn btn-outline" id="btn-skip-nota">Sin nota</button>
        <button class="btn btn-primary" id="btn-step-nota">Siguiente</button>
      </div>
    </div>
  `;

  const textarea = document.getElementById('input-nota');
  const counter = document.getElementById('nota-counter');

  textarea.addEventListener('input', () => {
    agenda.nota = textarea.value;
    counter.textContent = `${textarea.value.length}/500`;
  });

  document.getElementById('btn-skip-nota').addEventListener('click', () => {
    agenda.nota = '';
    goNext();
  });

  document.getElementById('btn-step-nota').addEventListener('click', () => {
    agenda.nota = textarea.value.trim();
    goNext();
  });
}

// Paso "confirmar": resumen
function renderStepConfirmar(el) {
  const anticipoNum = parseFloat(agenda.anticipo) || 0;

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Confirma los datos</label>
      <div class="summary">
        <div class="summary-row">
          <span class="summary-label">Clienta</span>
          <span class="summary-value">${escapeHTML(agenda.clienta)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Fecha</span>
          <span class="summary-value">${formatFechaDisplay(agenda.fecha)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Hora</span>
          <span class="summary-value">${formatHora12(agenda.hora)}</span>
        </div>
        ${agenda.telefono ? `
          <div class="summary-row">
            <span class="summary-label">Teléfono</span>
            <span class="summary-value">${escapeHTML(agenda.telefono)}</span>
          </div>
        ` : ''}
        <div class="summary-row">
          <span class="summary-label">Anticipo</span>
          <span class="summary-value">${anticipoNum > 0 ? formatMXN(anticipoNum) : 'Sin anticipo'}</span>
        </div>
        ${anticipoNum > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Pago del anticipo</span>
            <span class="summary-value">${agenda.anticipoMetodoPago}</span>
          </div>
        ` : ''}
        ${agenda.nota ? `
          <div class="summary-section-title">Nota</div>
          <div class="summary-nota">${escapeHTML(agenda.nota)}</div>
        ` : ''}
      </div>
      <button class="btn btn-primary mt-24" id="btn-confirmar">Confirmar y Agendar</button>
    </div>
  `;

  document.getElementById('btn-confirmar').addEventListener('click', submitAgendarCita);
}

async function submitAgendarCita() {
  if (enviandoAgenda) return;
  enviandoAgenda = true;
  const btn = document.getElementById('btn-confirmar');
  if (btn) btn.disabled = true;

  try {
    showLoader();
    const anticipoNum = parseFloat(agenda.anticipo) || 0;

    await createCitaAgendada(session.sheet_id, {
      clienta: agenda.clienta,
      fecha: agenda.fecha,
      hora: agenda.hora,
      anticipo: anticipoNum,
      anticipo_metodo_pago: anticipoNum > 0 ? agenda.anticipoMetodoPago : undefined,
      nota: agenda.nota,
      timestamp: nowTimestamp(),
    });

    // Guardar el teléfono es aparte porque vive en `clientas`, no en la
    // cita agendada — si falla, no debe tumbar el agendado (que ya se
    // guardó bien). Solo se manda si cambió de lo que ya traía la clienta.
    if (agenda.telefono && agenda.telefono !== telefonoOriginal) {
      try {
        await saveNotaFija(session.sheet_id, agenda.clienta, notasFijas[normalizeNombre(agenda.clienta)] || '', agenda.telefono);
      } catch {
        /* silencioso */
      }
    }

    hideLoader();
    showToast('Cita agendada correctamente', 'success');
    navigateTo('agenda');
  } catch (error) {
    hideLoader();
    showToast('Error al agendar la cita', 'error');
    enviandoAgenda = false;
    if (btn) btn.disabled = false;
  }
}
