/**
 * Flujo Registrar Gasto (4 pasos)
 * 1. Descripción
 * 2. Monto
 * 3. Método de pago
 * 4. Confirmación
 */

import { createGasto } from '../api.js';
import { formatMXN, todayISO, nowTimestamp, showToast, showLoader, hideLoader, escapeHTML, METODOS_PAGO } from '../utils.js';
import { navigateTo } from '../app.js';

let session = null;
let step = 1;
let gasto = { descripcion: '', monto: '', metodo_pago: '' };

export function render(s) {
  session = s;
  return `
    <div class="screen" id="gasto-screen">
      <header class="screen-header">
        <button class="header-back" id="gasto-back">← Atrás</button>
        <h2 class="screen-title">Registrar Gasto</h2>
      </header>

      <div class="step-indicator" id="step-indicator">
        <div class="step-dot active"></div>
        <div class="step-dot"></div>
        <div class="step-dot"></div>
        <div class="step-dot"></div>
      </div>

      <div id="gasto-step-content"></div>
    </div>
  `;
}

export function init(s) {
  session = s;
  step = 1;
  gasto = { descripcion: '', monto: '', metodo_pago: '' };
  enviandoGasto = false;

  document.getElementById('gasto-back').addEventListener('click', handleBack);
  renderStep();
}

function handleBack() {
  if (step > 1) {
    step--;
    renderStep();
  } else {
    navigateTo('home');
  }
}

function updateStepIndicator() {
  const dots = document.querySelectorAll('#step-indicator .step-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i < step);
  });
}

function renderStep() {
  updateStepIndicator();
  const container = document.getElementById('gasto-step-content');

  switch (step) {
    case 1: renderStep1(container); break;
    case 2: renderStep2(container); break;
    case 3: renderStep3(container); break;
    case 4: renderStep4(container); break;
  }
}

// Paso 1: Descripción del gasto
function renderStep1(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Descripción del gasto</label>
      <input type="text" class="input" id="input-descripcion" placeholder="Ej: Compra de shampoo"
        value="${escapeHTML(gasto.descripcion)}" autocomplete="off">
      <button class="btn btn-primary mt-24" id="btn-step1">Siguiente</button>
    </div>
  `;

  const input = document.getElementById('input-descripcion');
  const btn = document.getElementById('btn-step1');

  const advance = () => {
    const val = input.value.trim();
    if (!val) { showToast('Ingresa la descripción del gasto', 'error'); return; }
    gasto.descripcion = val;
    step = 2;
    renderStep();
  };

  btn.addEventListener('click', advance);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') advance(); });
  input.focus();
}

// Paso 2: Monto
function renderStep2(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Monto del gasto</label>
      <div class="amount-display">
        <span class="amount-display-currency">$</span>
        <span class="amount-display-value" id="monto-display">${gasto.monto || '0'}</span>
      </div>
      <div class="keypad" id="monto-keypad">
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

  document.getElementById('monto-keypad').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (!key) return;
    const k = key.dataset.key;

    if (k === 'delete') {
      gasto.monto = gasto.monto.slice(0, -1);
    } else if (k === 'ok') {
      if (!gasto.monto || gasto.monto === '0') {
        showToast('Ingresa el monto', 'error');
        return;
      }
      step = 3;
      renderStep();
      return;
    } else {
      if (gasto.monto === '0') gasto.monto = '';
      if (gasto.monto.length < 7) gasto.monto += k;
    }

    document.getElementById('monto-display').textContent = gasto.monto || '0';
  });
}

// Paso 3: Método de pago
function renderStep3(el) {
  const metodos = METODOS_PAGO;

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Método de pago</label>
      <div class="payment-grid">
        ${metodos.map((m) => `
          <button class="payment-card ${gasto.metodo_pago === m.id ? 'selected' : ''}" data-metodo="${m.id}">
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
    gasto.metodo_pago = card.dataset.metodo;
    step = 4;
    renderStep();
  });
}

// Paso 4: Confirmación
function renderStep4(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Confirma los datos</label>
      <div class="summary">
        <div class="summary-row">
          <span class="summary-label">Descripción</span>
          <span class="summary-value">${escapeHTML(gasto.descripcion)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Monto</span>
          <span class="summary-value">${formatMXN(parseFloat(gasto.monto))}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Pago</span>
          <span class="summary-value">${gasto.metodo_pago}</span>
        </div>
      </div>
      <button class="btn btn-primary mt-24" id="btn-confirmar">Confirmar y Registrar</button>
    </div>
  `;

  document.getElementById('btn-confirmar').addEventListener('click', submitGasto);
}

let enviandoGasto = false;

async function submitGasto() {
  // Sin esto, un doble tap por lag de red registraba el gasto dos veces.
  if (enviandoGasto) return;
  enviandoGasto = true;
  const btn = document.getElementById('btn-confirmar');
  if (btn) btn.disabled = true;

  try {
    showLoader();
    await createGasto(session.sheet_id, {
      fecha: todayISO(),
      timestamp: nowTimestamp(),
      descripcion: gasto.descripcion,
      monto: parseFloat(gasto.monto),
      metodo_pago: gasto.metodo_pago,
    });
    hideLoader();
    showToast('Gasto registrado correctamente', 'success');
    navigateTo('home');
  } catch (error) {
    hideLoader();
    showToast('Error al registrar el gasto', 'error');
    enviandoGasto = false;
    if (btn) btn.disabled = false;
  }
}
