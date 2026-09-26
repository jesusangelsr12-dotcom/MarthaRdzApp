/**
 * Pantalla de Login
 * Una sola pantalla: logo JR + PIN de 6 dígitos + teclado numérico
 * El backend determina automáticamente a qué salón pertenece el PIN.
 */

import { login as apiLogin, getWebauthnLoginOptions, verifyWebauthnLogin } from '../api.js';
import { showToast, showLoader, hideLoader } from '../utils.js';
import { saveSession } from '../auth.js';
import { navigateTo } from '../app.js';
import { biometriaDisponible, biometriaActivaEnEsteDispositivo, iniciarSesionConBiometria, olvidarBiometriaEnEsteDispositivo } from '../webauthn-client.js';

let pin = '';

/** Guarda la sesión con el mismo shape sin importar si se entró con PIN o con Face ID/Touch ID. */
function guardarSesion(result) {
  saveSession({
    token: result.token,
    salon_id: result.salon_id,
    salon_nombre: result.salon_nombre,
    sheet_id: result.sheet_id,
    logo_url: result.logo_url,
    servicios: result.servicios,
    productos: result.productos,
    trabajadoras: result.trabajadoras,
    // Si el PIN fue de una trabajadora, no de la dueña — sin esto la app
    // nunca se entera del rol y le muestra todo, aunque el backend ya
    // bloquee las llamadas.
    role: result.role,
    worker_nombre: result.worker_nombre,
  });
}

export function render() {
  return `
    <div class="screen screen-centered" id="login-screen">
      <div class="login-container">
        <div class="text-center mb-24">
          <div class="login-brand">
            <img class="login-logo" src="/img/logo.png" alt="Martha Rdz Hairartist">
          </div>
          <p class="login-tagline">Tu sal\u00f3n, siempre en orden</p>
        </div>

        <div id="biometria-login" class="hidden">
          <button class="btn btn-primary mb-16" id="btn-login-biometria">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px; margin-right: 6px">
              <path d="M12 11a2 2 0 0 0-2 2v2a2 2 0 0 0 4 0"/>
              <path d="M6 8a6 6 0 0 1 12 0v3"/>
              <path d="M6 11v2a6 6 0 0 0 1.7 4.2"/>
              <path d="M18 11v2a6 6 0 0 1-.8 3"/>
              <path d="M9 21a8.9 8.9 0 0 0 3 1 8.9 8.9 0 0 0 3-1"/>
              <path d="M4.2 15a9 9 0 0 1-.2-2v-3a8 8 0 0 1 1-3.9"/>
              <path d="M19.8 15a9 9 0 0 0 .2-2v-3a8 8 0 0 0-2.3-5.6"/>
            </svg>
            Usar Face ID / Touch ID
          </button>
          <p class="text-center" style="color: var(--color-gray-400); font-size: 0.78rem; margin: -8px 0 20px">o ingresa tu PIN</p>
        </div>

        <p class="text-center mb-16" style="color: var(--color-gray-500); font-size: 0.9rem">
          Ingresa tu PIN de 6 dígitos
        </p>

        <div class="pin-dots" id="pin-dots">
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
        </div>

        <div id="pin-error" class="text-center hidden" style="color: var(--color-error); font-size: 0.85rem; margin-bottom: 16px">
          PIN incorrecto. Intenta de nuevo.
        </div>

        <div class="keypad" id="pin-keypad">
          <button class="keypad-key" data-key="1">1</button>
          <button class="keypad-key" data-key="2">2</button>
          <button class="keypad-key" data-key="3">3</button>
          <button class="keypad-key" data-key="4">4</button>
          <button class="keypad-key" data-key="5">5</button>
          <button class="keypad-key" data-key="6">6</button>
          <button class="keypad-key" data-key="7">7</button>
          <button class="keypad-key" data-key="8">8</button>
          <button class="keypad-key" data-key="9">9</button>
          <button class="keypad-key keypad-key--empty" disabled></button>
          <button class="keypad-key" data-key="0">0</button>
          <button class="keypad-key keypad-key--delete" data-key="delete">⌫</button>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  pin = '';

  // Teclado numérico (event delegation)
  document.getElementById('pin-keypad').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (!key) return;
    handleKeyPress(key.dataset.key);
  });

  document.getElementById('btn-login-biometria').addEventListener('click', loginConBiometria);
  initBiometria();
}

/** Muestra el botón de Face ID/Touch ID solo si este dispositivo ya lo
 * activó antes Y el sistema operativo lo sigue soportando (pudo cambiar
 * de dispositivo restaurando el localStorage, por ejemplo). */
async function initBiometria() {
  if (!biometriaActivaEnEsteDispositivo()) return;
  if (!(await biometriaDisponible())) return;
  document.getElementById('biometria-login').classList.remove('hidden');
}

async function loginConBiometria() {
  const boton = document.getElementById('btn-login-biometria');
  boton.disabled = true;

  try {
    showLoader();
    const result = await iniciarSesionConBiometria({
      getOptions: getWebauthnLoginOptions,
      verify: verifyWebauthnLogin,
    });
    guardarSesion(result);
    hideLoader();
    navigateTo('home');
  } catch (error) {
    hideLoader();
    if (error.message === 'Cancelado') {
      // La usuaria canceló el gesto (Face ID/Touch ID) a propósito —
      // se queda en la pantalla para intentar de nuevo o usar el PIN.
    } else if (error.message?.includes('no tiene Face ID')) {
      // El dispositivo tenía la bandera local pero el servidor ya no
      // conoce esta credencial (se desactivó desde Configuración en otro
      // dispositivo, por ejemplo) — no insistir con el botón.
      olvidarBiometriaEnEsteDispositivo();
      document.getElementById('biometria-login').classList.add('hidden');
      showToast('Face ID/Touch ID ya no está activo — usa tu PIN', 'error');
    } else {
      showToast(error.message || 'No se pudo verificar Face ID/Touch ID', 'error');
    }
  } finally {
    boton.disabled = false;
  }
}

function handleKeyPress(key) {
  document.getElementById('pin-error').classList.add('hidden');

  if (key === 'delete') {
    pin = pin.slice(0, -1);
    updatePinDots();
    return;
  }

  if (pin.length >= 6) return;

  pin += key;
  updatePinDots();

  // Auto-submit al completar 6 dígitos
  if (pin.length === 6) {
    validatePin();
  }
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.remove('filled', 'error');
    if (i < pin.length) {
      dot.classList.add('filled');
    }
  });
}

function showPinError() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((dot) => dot.classList.add('error'));
  document.getElementById('pin-error').classList.remove('hidden');

  setTimeout(() => {
    pin = '';
    updatePinDots();
  }, 600);
}

async function validatePin() {
  const keypad = document.getElementById('pin-keypad');
  keypad.style.pointerEvents = 'none';

  try {
    showLoader();
    const result = await apiLogin(pin);
    guardarSesion(result);

    hideLoader();
    navigateTo('home');
  } catch (error) {
    hideLoader();
    if (error.message.includes('incorrecto')) {
      showPinError();
    } else if (error.message.includes('Demasiados intentos')) {
      showToast(error.message, 'error');
      pin = '';
      updatePinDots();
    } else {
      showToast('Error de conexión. Intenta de nuevo.', 'error');
      pin = '';
      updatePinDots();
    }
  } finally {
    keypad.style.pointerEvents = '';
  }
}
