/**
 * Flujo Registrar Cita
 *
 * Los pasos NO son números fijos: se arman dinámicamente según el salón
 * (ver STEPS y activeSteps). Un salón sin productos, por ejemplo, nunca ve
 * ese paso. Así se evitan los saltos especiales que había antes.
 *
 * - clienta     Nombre (con autocomplete) + fecha de la cita (default: hoy)
 * - servicios   Multi-selección (solo si el salón tiene catálogo de servicios)
 * - productos   Multi-selección (solo si el salón tiene catálogo de productos)
 * - precios     Costo de cada item, uno por uno (con sub-navegación interna)
 * - comisiones  Trabajadora + % por item (solo si hay trabajadoras)
 * - notas       Fórmula usada / notas de la visita (opcional)
 * - pago        Método de pago
 * - confirmar   Resumen con desglose, comisiones y total
 *
 * Debe haber al menos un servicio o un producto seleccionado en total.
 */

import { createCita, getClientas, getCitasAgendadas } from '../api.js';
import { formatMXN, todayISO, nowTimestamp, showToast, showLoader, hideLoader, escapeHTML, normalizeNombre, METODOS_PAGO, formatHora12 } from '../utils.js';
import { navigateTo } from '../app.js';
import { isTrabajadora, getWorkerName } from '../auth.js';

let session = null;
let stepKey = 'clienta';
let allClientas = [];
let notasFijas = {};   // { claveNormalizada: nota } para avisar de alergias
let citasAgendadasHoy = []; // pendientes de hoy, para los recuadros de "cita agendada"

// Estado de la cita
let cita = {
  clienta: '',
  fecha: '',               // YYYY-MM-DD (default: hoy, editable en paso 1)
  selectedServicios: [],
  selectedProductos: [],
  items: [],              // [{tipo, nombre, costo}]
  comisionesMap: {},       // { itemIndex: { trabajadora, pct, comision } }
  nota: '',                // fórmula usada / notas de la visita
  metodo_pago: '',
  agendaId: null,          // si viene de un recuadro de cita agendada
  anticipoAgenda: 0,       // anticipo ya cobrado de esa cita agendada
  agendaClienta: '',       // nombre y fecha de esa cita agendada, para soltarla
  agendaFecha: '',         // si luego se cambian (ver soltarAgendaSiCambio)
};

/** La Agenda abre "#cita?fecha=2026-09-20" para cobrar una cita de otro día
 * (ej. una pendiente que se quedó sin cerrar). Mismo patrón que agendar.js. */
function fechaDesdeHash() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const fecha = new URLSearchParams(hash.slice(qIndex + 1)).get('fecha');
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? fecha : null;
}

/** Si ya se eligió un recuadro de cita agendada y después se escribió otra
 * clienta u otra fecha, ese cobro ya no es de esa cita: se suelta el
 * vínculo (y su anticipo). Sin esto, el cobro de otra persona completaba la
 * cita agendada equivocada y le descontaba un anticipo ajeno. */
function soltarAgendaSiCambio() {
  if (!cita.agendaId) return;
  const mismaClienta = normalizeNombre(cita.clienta) === normalizeNombre(cita.agendaClienta);
  if (mismaClienta && cita.fecha === cita.agendaFecha) return;
  cita.agendaId = null;
  cita.anticipoAgenda = 0;
  cita.agendaClienta = '';
  cita.agendaFecha = '';
}

// Para el paso 4: pricing
let pricingItems = [];
let pricingIndex = 0;
let currentCosto = '';

/** Muestra una fecha YYYY-MM-DD como "12 de julio de 2026" */
function formatFechaDisplay(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Secuencia completa de pasos, en orden.
const STEPS = ['clienta', 'servicios', 'productos', 'precios', 'comisiones', 'notas', 'pago', 'confirmar'];

/** Pasos que aplican a este salón, en orden. */
function activeSteps() {
  return STEPS.filter((k) => {
    if (k === 'servicios') return (session?.servicios || []).length > 0;
    if (k === 'productos') return (session?.productos || []).length > 0;
    if (k === 'comisiones') return (session?.trabajadoras || []).length > 0;
    return true;
  });
}

/** Va a un paso concreto y lo dibuja. */
function goTo(key) {
  stepKey = key;
  renderStep();
}

/** Avanza al siguiente paso activo. */
function goNext() {
  const steps = activeSteps();
  const next = steps[steps.indexOf(stepKey) + 1];
  if (!next) return;
  // Al entrar a precios desde atrás, armar la lista de items a cotizar
  if (next === 'precios') preparePricing();
  goTo(next);
}

export function render(s) {
  session = s;
  const totalSteps = activeSteps().length;
  return `
    <div class="screen" id="cita-screen">
      <header class="screen-header">
        <button class="header-back" id="cita-back">\u2190 Atr\u00e1s</button>
        <h2 class="screen-title">Registrar Cita</h2>
      </header>

      <div class="step-indicator" id="step-indicator">
        ${Array.from({ length: totalSteps }, () => '<div class="step-dot"></div>').join('')}
      </div>

      <div id="cita-step-content"></div>
    </div>
  `;
}

export function init(s) {
  session = s;
  stepKey = 'clienta';
  cita = {
    clienta: '',
    fecha: fechaDesdeHash() || todayISO(),
    selectedServicios: [],
    selectedProductos: [],
    items: [],
    comisionesMap: {},
    nota: '',
    metodo_pago: '',
    agendaId: null,
    anticipoAgenda: 0,
    agendaClienta: '',
    agendaFecha: '',
  };
  pricingItems = [];
  pricingIndex = 0;
  currentCosto = '';
  allClientas = [];
  notasFijas = {};
  citasAgendadasHoy = [];
  enviandoCita = false;

  document.getElementById('cita-back').addEventListener('click', goBack);

  // Sin catálogo de servicios NI de productos no hay nada que registrar:
  // los pasos de selección no existirían y se llegaría a precios sin items.
  const sinCatalogo = (session?.servicios || []).length === 0
    && (session?.productos || []).length === 0;
  if (sinCatalogo) {
    renderSinCatalogo(document.getElementById('cita-step-content'));
    return;
  }

  renderStep();

  // Cargar clientas para autocomplete (non-blocking)
  if (session?.sheet_id) {
    getClientas(session.sheet_id)
      .then((res) => {
        allClientas = res.clientas || [];
        notasFijas = res.notas_fijas || {};
      })
      .catch(() => { /* silencioso */ });

    // Citas agendadas pendientes de la fecha elegida (non-blocking): permiten
    // saltar directo a servicios/precios sin volver a teclear nombre/fecha.
    cargarCitasAgendadasDelDia(cita.fecha || todayISO());
  }
}

/** Consulta las citas agendadas pendientes de una fecha y repinta sus
 * recuadros. Se llama al entrar al paso y cada vez que se cambia la fecha,
 * para que el recuadro siga la fecha elegida, no solo la de hoy. */
async function cargarCitasAgendadasDelDia(fecha) {
  if (!session?.sheet_id) return;
  try {
    const res = await getCitasAgendadas(session.sheet_id, { fecha, estado: 'pendiente' });
    // Si mientras cargaba la usuaria ya cambió la fecha otra vez, esta
    // respuesta quedó vieja: no pisar lo que se esté mostrando ahora.
    const fechaInput = document.getElementById('input-fecha-cita');
    if (fechaInput && fechaInput.value !== fecha) return;
    citasAgendadasHoy = res.citas_agendadas || [];
    renderAgendaHoyCards(fecha);
  } catch {
    /* silencioso */
  }
}

/** Pinta (o repinta) los recuadros de citas agendadas pendientes de `fecha`,
 * sin tocar el resto del paso — así no se pierde el foco del input mientras
 * se escribe. */
function renderAgendaHoyCards(fecha) {
  const container = document.getElementById('agenda-hoy-container');
  if (!container) return;

  if (citasAgendadasHoy.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="agenda-hoy-label">Citas agendadas para el ${formatFechaDisplay(fecha)}</div>
    <div class="agenda-hoy-list">
      ${citasAgendadasHoy.map((c) => `
        <button class="agenda-hoy-card" type="button" data-agenda-id="${c.id}">
          <span class="agenda-hoy-card-hora">${formatHora12(c.hora)}</span>
          <span class="agenda-hoy-card-clienta">${escapeHTML(c.clienta)}</span>
          ${c.anticipo > 0 ? `<span class="agenda-hoy-card-anticipo">${formatMXN(c.anticipo)}</span>` : ''}
        </button>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.agenda-hoy-card').forEach((btn) => {
    btn.addEventListener('click', () => seleccionarCitaAgendada(btn.dataset.agendaId));
  });
}

/** Tocar un recuadro llena nombre y fecha, y sigue directo con goNext(). */
function seleccionarCitaAgendada(agendaId) {
  const c = citasAgendadasHoy.find((x) => x.id === agendaId);
  if (!c) return;
  cita.clienta = c.clienta;
  cita.fecha = c.fecha;
  cita.agendaId = c.id;
  cita.anticipoAgenda = c.anticipo;
  cita.agendaClienta = c.clienta;
  cita.agendaFecha = c.fecha;
  goNext();
}

function renderSinCatalogo(el) {
  // Una trabajadora no entra a Configuración: el botón la regresaba al
  // Inicio sin explicación. A ella se le dice a quién pedírselo.
  if (isTrabajadora()) {
    el.innerHTML = `
      <div class="step-content">
        <div class="empty-state">
          <div class="empty-state-emoji">⚙️</div>
          <p class="empty-state-text">Todavía no hay servicios ni productos en el salón. Pídele a la dueña que los agregue.</p>
        </div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="step-content">
      <div class="empty-state">
        <div class="empty-state-emoji">⚙️</div>
        <p class="empty-state-text">No hay servicios ni productos configurados</p>
        <button class="btn btn-outline mt-16" id="btn-go-config">Ir a Configuración</button>
      </div>
    </div>
  `;
  document.getElementById('btn-go-config').addEventListener('click', () => navigateTo('config'));
}

/** Retrocede: primero dentro del sub-paso de precios, luego entre pasos. */
function goBack() {
  // El paso de precios cotiza item por item: retroceder ahí es interno
  if (stepKey === 'precios' && pricingIndex > 0) {
    pricingIndex--;
    currentCosto = String(pricingItems[pricingIndex].costo || '');
    renderStep();
    return;
  }

  const steps = activeSteps();
  const prev = steps[steps.indexOf(stepKey) - 1];
  if (!prev) {
    navigateTo('home');
    return;
  }

  // Al volver a precios, reanudar en el último item ya cotizado
  if (prev === 'precios' && pricingItems.length > 0) {
    pricingIndex = pricingItems.length - 1;
    currentCosto = String(pricingItems[pricingIndex].costo || '');
  }
  goTo(prev);
}

function updateStepIndicator() {
  const activeIndex = activeSteps().indexOf(stepKey);
  const dots = document.querySelectorAll('#step-indicator .step-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i <= activeIndex);
  });
}

function renderStep() {
  updateStepIndicator();
  const container = document.getElementById('cita-step-content');

  switch (stepKey) {
    case 'clienta': renderStepClienta(container); break;
    case 'servicios': renderStepServicios(container); break;
    case 'productos': renderStepProductos(container); break;
    case 'precios': renderStepPrecios(container); break;
    case 'comisiones': renderStepComisiones(container); break;
    case 'notas': renderStepNotas(container); break;
    case 'pago': renderStepPago(container); break;
    case 'confirmar': renderStepConfirmar(container); break;
  }
}

// Paso "clienta": nombre (con autocomplete) + fecha de la cita
function renderStepClienta(el) {
  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Nombre de la clienta</label>
      <div class="clienta-input-wrapper">
        <input type="text" class="input" id="input-clienta" placeholder="Ej: Mar\u00eda L\u00f3pez"
          value="${escapeHTML(cita.clienta)}" autocomplete="off">
        <div class="clienta-suggestions hidden" id="clienta-suggestions"></div>
      </div>

      <div id="agenda-hoy-container"></div>

      <label class="input-label mt-24">Fecha de la cita</label>
      <input type="date" class="date-picker-input" id="input-fecha-cita"
        value="${cita.fecha || todayISO()}">

      <button class="btn btn-primary mt-24" id="btn-step1">Siguiente</button>
    </div>
  `;

  const input = document.getElementById('input-clienta');
  const suggestionsEl = document.getElementById('clienta-suggestions');
  const fechaInput = document.getElementById('input-fecha-cita');
  const btn = document.getElementById('btn-step1');

  fechaInput.addEventListener('change', () => {
    if (fechaInput.value) {
      cita.fecha = fechaInput.value;
      cargarCitasAgendadasDelDia(fechaInput.value);
    }
  });

  const advance = () => {
    const val = input.value.trim();
    if (!val) { showToast('Ingresa el nombre de la clienta', 'error'); return; }
    if (!fechaInput.value) { showToast('Selecciona la fecha de la cita', 'error'); return; }
    cita.clienta = val;
    cita.fecha = fechaInput.value;
    soltarAgendaSiCambio();
    goNext();
  };

  btn.addEventListener('click', advance);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') advance(); });

  // Autocomplete
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();

    if (query.length < 2 || allClientas.length === 0) {
      suggestionsEl.classList.add('hidden');
      return;
    }

    const matches = allClientas
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, 5);

    if (matches.length === 0) {
      suggestionsEl.classList.add('hidden');
      return;
    }

    suggestionsEl.innerHTML = matches.map((name) =>
      `<button class="clienta-suggestion-item" type="button">${escapeHTML(name)}</button>`
    ).join('');
    suggestionsEl.classList.remove('hidden');
  });

  // Click on suggestion
  suggestionsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.clienta-suggestion-item');
    if (!item) return;
    input.value = item.textContent;
    cita.clienta = item.textContent;
    suggestionsEl.classList.add('hidden');
  });

  // Hide suggestions on blur (delayed so click fires first)
  input.addEventListener('blur', () => {
    setTimeout(() => suggestionsEl.classList.add('hidden'), 200);
  });

  input.focus();
  renderAgendaHoyCards(cita.fecha || todayISO());
}

// Paso "servicios": multi-selección (este paso solo existe si hay catálogo)
function renderStepServicios(el) {
  const servicios = session?.servicios || [];

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Selecciona los servicios</label>
      <p class="multi-select-hint">Puedes elegir m\u00e1s de uno, o saltar si solo llev\u00f3 producto</p>
      <div class="services-grid" id="services-grid">
        ${servicios.map((s) => `
          <button class="service-card ${cita.selectedServicios.includes(s) ? 'selected' : ''}" data-servicio="${escapeHTML(s)}">
            <span class="service-card-name">${escapeHTML(s)}</span>
            ${cita.selectedServicios.includes(s) ? '<span class="service-card-check">\u2713</span>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="step-actions mt-24">
        <button class="btn btn-outline" id="btn-skip-services">Sin servicios</button>
        <button class="btn btn-primary" id="btn-step2"
          ${cita.selectedServicios.length === 0 ? 'disabled style="opacity:0.5"' : ''}>
          Siguiente (${cita.selectedServicios.length})
        </button>
      </div>
    </div>
  `;

  document.getElementById('services-grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-servicio]');
    if (!card) return;
    const name = card.dataset.servicio;
    const idx = cita.selectedServicios.indexOf(name);
    if (idx >= 0) cita.selectedServicios.splice(idx, 1);
    else cita.selectedServicios.push(name);
    renderStepServicios(el);
  });

  document.getElementById('btn-skip-services').addEventListener('click', () => {
    const productosDisp = session?.productos || [];
    if (productosDisp.length === 0) {
      showToast('No hay productos configurados; selecciona al menos un servicio', 'error');
      return;
    }
    cita.selectedServicios = [];
    goNext();
  });

  document.getElementById('btn-step2').addEventListener('click', () => {
    if (cita.selectedServicios.length === 0) {
      showToast('Selecciona al menos un servicio o toca "Sin servicios"', 'error');
      return;
    }
    goNext();
  });
}

// Paso "productos": multi-selección (este paso solo existe si hay catálogo)
function renderStepProductos(el) {
  const productosDisp = session?.productos || [];

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Productos vendidos</label>
      <p class="multi-select-hint">Selecciona si la clienta compr\u00f3 productos</p>
      <div class="services-grid" id="products-grid">
        ${productosDisp.map((p) => `
          <button class="service-card ${cita.selectedProductos.includes(p) ? 'selected' : ''}" data-producto="${escapeHTML(p)}">
            <span class="service-card-name">${escapeHTML(p)}</span>
            ${cita.selectedProductos.includes(p) ? '<span class="service-card-check">\u2713</span>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="step-actions mt-24">
        <button class="btn btn-outline" id="btn-skip-products">Sin productos</button>
        <button class="btn btn-primary" id="btn-step3"
          ${cita.selectedProductos.length === 0 ? 'disabled style="opacity:0.5"' : ''}>
          Siguiente (${cita.selectedProductos.length})
        </button>
      </div>
    </div>
  `;

  document.getElementById('products-grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-producto]');
    if (!card) return;
    const name = card.dataset.producto;
    const idx = cita.selectedProductos.indexOf(name);
    if (idx >= 0) cita.selectedProductos.splice(idx, 1);
    else cita.selectedProductos.push(name);
    renderStepProductos(el);
  });

  document.getElementById('btn-skip-products').addEventListener('click', () => {
    // No permitir cita vacía: sin servicios Y sin productos
    if (cita.selectedServicios.length === 0) {
      showToast('Selecciona al menos un producto (no elegiste servicios)', 'error');
      return;
    }
    cita.selectedProductos = [];
    goNext();
  });

  document.getElementById('btn-step3').addEventListener('click', () => {
    if (cita.selectedProductos.length === 0) {
      showToast('Selecciona al menos un producto o toca "Sin productos"', 'error');
      return;
    }
    goNext();
  });
}

function preparePricing() {
  pricingItems = [
    ...cita.selectedServicios.map((name) => ({ tipo: 'servicio', nombre: name, costo: '' })),
    ...cita.selectedProductos.map((name) => ({ tipo: 'producto', nombre: name, costo: '' })),
  ];
  pricingIndex = 0;
  currentCosto = '';
}

// Paso "precios": costo de cada item, uno por uno
function renderStepPrecios(el) {
  const item = pricingItems[pricingIndex];
  const totalItems = pricingItems.length;
  const tipoLabel = item.tipo === 'servicio' ? 'Servicio' : 'Producto';

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">
        Costo de ${tipoLabel.toLowerCase()} (${pricingIndex + 1} de ${totalItems})
      </label>
      <div class="pricing-item-name">${escapeHTML(item.nombre)}</div>
      <div class="pricing-item-badge pricing-item-badge--${item.tipo}">${tipoLabel}</div>
      <div class="amount-display">
        <span class="amount-display-currency">$</span>
        <span class="amount-display-value" id="costo-display">${currentCosto || '0'}</span>
      </div>
      <div class="keypad" id="costo-keypad">
        <button class="keypad-key" data-key="1">1</button>
        <button class="keypad-key" data-key="2">2</button>
        <button class="keypad-key" data-key="3">3</button>
        <button class="keypad-key" data-key="4">4</button>
        <button class="keypad-key" data-key="5">5</button>
        <button class="keypad-key" data-key="6">6</button>
        <button class="keypad-key" data-key="7">7</button>
        <button class="keypad-key" data-key="8">8</button>
        <button class="keypad-key" data-key="9">9</button>
        <button class="keypad-key keypad-key--delete" data-key="delete">\u232b</button>
        <button class="keypad-key" data-key="0">0</button>
        <button class="keypad-key keypad-key--confirm" data-key="ok">\u2713</button>
      </div>
    </div>
  `;

  document.getElementById('costo-keypad').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (!key) return;
    const k = key.dataset.key;

    if (k === 'delete') {
      currentCosto = currentCosto.slice(0, -1);
    } else if (k === 'ok') {
      if (!currentCosto || currentCosto === '0') {
        showToast('Ingresa el costo', 'error');
        return;
      }
      pricingItems[pricingIndex].costo = currentCosto;

      if (pricingIndex < pricingItems.length - 1) {
        pricingIndex++;
        currentCosto = pricingItems[pricingIndex].costo || '';
        renderStep();
      } else {
        // Guardar items con precios
        cita.items = pricingItems.map((it) => ({
          tipo: it.tipo,
          nombre: it.nombre,
          costo: parseFloat(it.costo),
        }));
        goNext();
      }
      return;
    } else {
      if (currentCosto === '0') currentCosto = '';
      if (currentCosto.length < 7) currentCosto += k;
    }

    document.getElementById('costo-display').textContent = currentCosto || '0';
  });
}

// Paso "comisiones": elegir trabajadora y escribir el % de cada item
function renderStepComisiones(el) {
  // Una trabajadora solo puede asignarse comisión a sí misma — no ve ni
  // puede elegir a otras (fuera de su alcance, como el resto de dinero
  // agregado). El backend también lo valida, esto es solo la UI.
  const trabajadoras = isTrabajadora() ? [getWorkerName()] : (session?.trabajadoras || []);
  // Nombre de la trabajadora, soportando formato viejo {nombre,...} o string
  const nombreOf = (t) => (typeof t === 'string' ? t : t.nombre);

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Comisiones (opcional)</label>
      <p class="multi-select-hint">Elige la trabajadora y escribe el % de cada uno</p>

      <div class="comision-items-list" id="comision-items-list">
        ${cita.items.map((item, i) => {
          const assigned = cita.comisionesMap[i];
          return `
            <div class="comision-item-card">
              <div class="comision-item-header">
                <span class="comision-item-name">${escapeHTML(item.nombre)}</span>
                <span class="comision-item-cost">${formatMXN(item.costo)}</span>
              </div>
              <div class="comision-item-badge comision-item-badge--${item.tipo}">
                ${item.tipo === 'servicio' ? 'Servicio' : 'Producto'}
              </div>
              <div class="comision-assign-row">
                <select class="comision-select" data-index="${i}">
                  <option value="">Sin comisi\u00f3n</option>
                  ${trabajadoras.map((t) => {
                    const nombre = nombreOf(t);
                    return `<option value="${escapeHTML(nombre)}" ${assigned && assigned.trabajadora === nombre ? 'selected' : ''}>${escapeHTML(nombre)}</option>`;
                  }).join('')}
                </select>
                <div class="comision-pct-wrap">
                  <input type="number" class="comision-pct-input" data-index="${i}"
                    placeholder="0" min="0" max="100" inputmode="numeric"
                    value="${assigned ? assigned.pct : ''}">
                  <span class="comision-pct-symbol">%</span>
                </div>
              </div>
              <div class="comision-preview ${assigned ? '' : 'hidden'}" data-preview="${i}">
                ${assigned ? `Comisi\u00f3n: ${formatMXN(assigned.comision)}` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="step-actions mt-24">
        <button class="btn btn-outline" id="btn-skip-comisiones">Sin comisiones</button>
        <button class="btn btn-primary" id="btn-step5">Siguiente</button>
      </div>
    </div>
  `;

  // Recalcula la comisi\u00f3n de un item a partir de la trabajadora + % escrito.
  // Actualiza solo el preview de ese item (sin re-render) para no perder el foco.
  const recalc = (idx) => {
    const selectEl = el.querySelector(`.comision-select[data-index="${idx}"]`);
    const pctEl = el.querySelector(`.comision-pct-input[data-index="${idx}"]`);
    const previewEl = el.querySelector(`[data-preview="${idx}"]`);
    const worker = selectEl.value;
    const pct = parseFloat(pctEl.value);

    if (worker && pct > 0) {
      const item = cita.items[idx];
      const comision = Math.round(item.costo * pct / 100 * 100) / 100;
      cita.comisionesMap[idx] = { trabajadora: worker, pct, comision };
      previewEl.textContent = `Comisi\u00f3n: ${formatMXN(comision)}`;
      previewEl.classList.remove('hidden');
    } else {
      delete cita.comisionesMap[idx];
      previewEl.textContent = '';
      previewEl.classList.add('hidden');
    }
  };

  el.querySelectorAll('.comision-select').forEach((select) => {
    select.addEventListener('change', () => recalc(parseInt(select.dataset.index, 10)));
  });
  el.querySelectorAll('.comision-pct-input').forEach((input) => {
    input.addEventListener('input', () => recalc(parseInt(input.dataset.index, 10)));
  });

  document.getElementById('btn-skip-comisiones').addEventListener('click', () => {
    cita.comisionesMap = {};
    goNext();
  });

  document.getElementById('btn-step5').addEventListener('click', () => {
    goNext();
  });
}

// Paso "notas": fórmula usada / notas de la visita (opcional)
function renderStepNotas(el) {
  // Si la clienta tiene nota fija (alergias, preferencias), este es el
  // momento en que importa: se muestra antes de escribir la fórmula.
  const notaFija = notasFijas[normalizeNombre(cita.clienta)] || '';

  el.innerHTML = `
    <div class="step-content">
      ${notaFija ? `
        <div class="nota-fija-banner">
          <span class="nota-fija-banner-label">Nota de ${escapeHTML(cita.clienta)}</span>
          <span class="nota-fija-banner-text">${escapeHTML(notaFija)}</span>
        </div>
      ` : ''}

      <label class="input-label">Fórmula o notas (opcional)</label>
      <p class="multi-select-hint">Lo que apuntes aquí lo verás en su historial la próxima visita</p>
      <textarea class="input textarea" id="input-nota" rows="5" maxlength="500"
        placeholder="Ej: Tinte 7.1 + 20 vol, 35 min">${escapeHTML(cita.nota)}</textarea>
      <div class="char-counter" id="nota-counter">${cita.nota.length}/500</div>

      <div class="step-actions mt-24">
        <button class="btn btn-outline" id="btn-skip-notas">Sin notas</button>
        <button class="btn btn-primary" id="btn-step-notas">Siguiente</button>
      </div>
    </div>
  `;

  const textarea = document.getElementById('input-nota');
  const counter = document.getElementById('nota-counter');

  textarea.addEventListener('input', () => {
    cita.nota = textarea.value;
    counter.textContent = `${textarea.value.length}/500`;
  });

  document.getElementById('btn-skip-notas').addEventListener('click', () => {
    cita.nota = '';
    goNext();
  });

  document.getElementById('btn-step-notas').addEventListener('click', () => {
    cita.nota = textarea.value.trim();
    goNext();
  });
}

// Paso "pago": método de pago
function renderStepPago(el) {
  const metodos = METODOS_PAGO;

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">M\u00e9todo de pago</label>
      <div class="payment-grid">
        ${metodos.map((m) => `
          <button class="payment-card ${cita.metodo_pago === m.id ? 'selected' : ''}" data-metodo="${m.id}">
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
    cita.metodo_pago = card.dataset.metodo;
    goNext();
  });
}

// Paso "confirmar": resumen con desglose y comisiones
function renderStepConfirmar(el) {
  const total = cita.items.reduce((sum, it) => sum + it.costo, 0);
  const serviciosItems = cita.items.filter((it) => it.tipo === 'servicio');
  const productosItems = cita.items.filter((it) => it.tipo === 'producto');
  const comisionesList = Object.entries(cita.comisionesMap);
  // Si viene de un recuadro de "cita agendada", el anticipo ya cobrado se
  // descuenta de lo que se cobra hoy (nunca más de lo que cuesta el servicio).
  const anticipoAplicado = cita.agendaId ? Math.min(cita.anticipoAgenda, total) : 0;
  const aCobrarHoy = total - anticipoAplicado;

  el.innerHTML = `
    <div class="step-content">
      <label class="input-label">Confirma los datos</label>
      <div class="summary">
        <div class="summary-row">
          <span class="summary-label">Clienta</span>
          <span class="summary-value">${escapeHTML(cita.clienta)}</span>
        </div>

        <div class="summary-row">
          <span class="summary-label">Fecha</span>
          <span class="summary-value">${formatFechaDisplay(cita.fecha)}</span>
        </div>

        ${serviciosItems.length > 0 ? `
          <div class="summary-section-title">Servicios</div>
          ${serviciosItems.map((it) => {
            const idx = cita.items.indexOf(it);
            const com = cita.comisionesMap[idx];
            return `
              <div class="summary-row summary-row--item">
                <span class="summary-label">
                  ${escapeHTML(it.nombre)}
                  ${com ? `<span class="summary-comision-tag">${escapeHTML(com.trabajadora)} ${com.pct}%</span>` : ''}
                </span>
                <span class="summary-value">${formatMXN(it.costo)}</span>
              </div>
            `;
          }).join('')}
        ` : ''}

        ${productosItems.length > 0 ? `
          <div class="summary-section-title">Productos</div>
          ${productosItems.map((it) => {
            const idx = cita.items.indexOf(it);
            const com = cita.comisionesMap[idx];
            return `
              <div class="summary-row summary-row--item">
                <span class="summary-label">
                  ${escapeHTML(it.nombre)}
                  ${com ? `<span class="summary-comision-tag">${escapeHTML(com.trabajadora)} ${com.pct}%</span>` : ''}
                </span>
                <span class="summary-value">${formatMXN(it.costo)}</span>
              </div>
            `;
          }).join('')}
        ` : ''}

        <div class="summary-row summary-row--total">
          <span class="summary-label">${cita.agendaId ? 'Precio del servicio' : 'Total'}</span>
          <span class="summary-value summary-value--total">${formatMXN(total)}</span>
        </div>

        ${cita.agendaId ? `
          <div class="summary-row">
            <span class="summary-label">Anticipo ya cobrado</span>
            <span class="summary-value">−${formatMXN(anticipoAplicado)}</span>
          </div>
          <div class="summary-row summary-row--total">
            <span class="summary-label">A cobrar hoy</span>
            <span class="summary-value summary-value--total">${formatMXN(aCobrarHoy)}</span>
          </div>
        ` : ''}

        ${comisionesList.length > 0 ? `
          <div class="summary-section-title">Comisiones</div>
          ${comisionesList.map(([idx, com]) => {
            const item = cita.items[parseInt(idx, 10)];
            return `
              <div class="summary-row summary-row--item">
                <span class="summary-label">${escapeHTML(com.trabajadora)} \u2014 ${escapeHTML(item.nombre)}</span>
                <span class="summary-value summary-value--comision">${formatMXN(com.comision)}</span>
              </div>
            `;
          }).join('')}
        ` : ''}

        <div class="summary-row">
          <span class="summary-label">Pago</span>
          <span class="summary-value">${cita.metodo_pago}</span>
        </div>

        ${cita.nota ? `
          <div class="summary-section-title">Fórmula / Notas</div>
          <div class="summary-nota">${escapeHTML(cita.nota)}</div>
        ` : ''}
      </div>
      <button class="btn btn-primary mt-24" id="btn-confirmar">Confirmar y Registrar</button>
    </div>
  `;

  document.getElementById('btn-confirmar').addEventListener('click', submitCita);
}

let enviandoCita = false;

async function submitCita() {
  // Sin esto, un doble tap por lag de red registraba la cita dos veces.
  if (enviandoCita) return;
  enviandoCita = true;
  const btn = document.getElementById('btn-confirmar');
  if (btn) btn.disabled = true;

  try {
    showLoader();
    const sumItems = cita.items.reduce((sum, it) => sum + it.costo, 0);
    // Si viene de una cita agendada, el anticipo ya cobrado se descuenta de
    // lo que se registra hoy; la comisión (abajo) sigue sobre el precio
    // completo de cada item, sin verse afectada por este descuento.
    const anticipoAplicado = cita.agendaId ? Math.min(cita.anticipoAgenda, sumItems) : 0;
    const total = sumItems - anticipoAplicado;

    // Armar array de comisiones para la hoja separada
    const comisiones = Object.entries(cita.comisionesMap).map(([idx, com]) => {
      const item = cita.items[parseInt(idx, 10)];
      return {
        trabajadora: com.trabajadora,
        item: item.nombre,
        tipo: item.tipo,
        costo: item.costo,
        pct: com.pct,
        comision: com.comision,
      };
    });

    await createCita(session.sheet_id, {
      fecha: cita.fecha || todayISO(),
      timestamp: nowTimestamp(),
      clienta: cita.clienta,
      items: cita.items,
      total,
      metodo_pago: cita.metodo_pago,
      nota: cita.nota,
      comisiones,
      agenda_id: cita.agendaId || undefined,
      anticipo_aplicado: cita.agendaId ? anticipoAplicado : undefined,
    });

    hideLoader();
    showToast('Cita registrada correctamente', 'success');
    navigateTo('home');
  } catch (error) {
    hideLoader();
    showToast(error.message || 'Error al registrar la cita', 'error');
    enviandoCita = false;
    if (btn) btn.disabled = false;
  }
}
