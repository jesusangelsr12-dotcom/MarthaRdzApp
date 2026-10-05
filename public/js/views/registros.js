/**
 * Pantalla Ver Registros
 * Muestra citas y gastos de cualquier día con totales (ingresos vs gastos)
 * Permite eliminar citas y gastos individuales, y corregir el cobro de una
 * cita (tocar su monto: precios y método de pago).
 *
 * La Agenda abre "#registros?fecha=2026-09-20&agenda=<id>" desde una cita
 * ya cobrada: abre en ese día y resalta su cobro. "← Atrás" regresa a la
 * Agenda en ese caso.
 */

import { getCitas, getGastos, deleteCita, deleteGasto, restoreCita, restoreGasto, updateCitaNota, updateCobro, getClientas } from '../api.js';
import { formatMXN, todayISO, showToast, showLoader, hideLoader, escapeHTML, normalizeNombre, loadingHTML, METODOS_PAGO } from '../utils.js';
import { navigateTo } from '../app.js';
import { compartirTexto } from '../whatsapp.js';

let session = null;
let selectedDate = '';
let citasActuales = [];
let telefonosPorClienta = {}; // { "clave normalizada": "4421234567" }
let agendaFoco = ''; // id de la cita agendada cuyo cobro hay que resaltar

/** Lee "?fecha=…&agenda=…" del hash (mismo patrón que cita.js). */
function paramsDesdeHash() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  const params = new URLSearchParams(qIndex === -1 ? '' : hash.slice(qIndex + 1));
  const fecha = params.get('fecha') || '';
  return {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : '',
    agenda: params.get('agenda') || '',
  };
}

/** Fila de solo-anticipo (dinero de una cita agendada, no una visita). */
function esSoloAnticipo(c) {
  const items = c.items || [];
  return items.length === 1 && items[0].tipo === 'anticipo';
}

function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function render(s) {
  session = s;
  selectedDate = paramsDesdeHash().fecha || todayISO();
  return `
    <div class="screen" id="registros-screen">
      <header class="screen-header">
        <button class="header-back" id="registros-back">\u2190 Atr\u00e1s</button>
        <h2 class="screen-title">Registros</h2>
      </header>

      <div class="date-picker-row">
        <input type="date" class="date-picker-input" id="date-picker"
          value="${selectedDate}" max="${todayISO()}">
      </div>

      <div class="totals-bar" id="totals-bar">
        <div class="total-card">
          <div class="total-card-label">Ingresos</div>
          <div class="total-card-value total-card-value--income" id="total-ingresos">$0.00</div>
        </div>
        <div class="total-card">
          <div class="total-card-label">Gastos</div>
          <div class="total-card-value total-card-value--expense" id="total-gastos">$0.00</div>
        </div>
      </div>

      <div id="registros-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando registros...')}
        </div>
      </div>
    </div>

    <!-- Modal de confirmaci\u00f3n para eliminar -->
    <div class="delete-modal hidden" id="delete-modal">
      <div class="delete-modal-backdrop" id="delete-modal-backdrop"></div>
      <div class="delete-modal-content">
        <div class="delete-modal-icon">\u26a0\ufe0f</div>
        <h3 class="delete-modal-title">Eliminar registro</h3>
        <p class="delete-modal-text" id="delete-modal-text">\u00bfEst\u00e1s seguro de eliminar este registro?</p>
        <div class="delete-modal-actions">
          <button class="btn btn-outline delete-modal-btn" id="delete-modal-cancel">Cancelar</button>
          <button class="btn delete-modal-btn delete-modal-btn--confirm" id="delete-modal-confirm">Eliminar</button>
        </div>
      </div>
    </div>

    <!-- Corregir el cobro de una cita -->
    <div class="delete-modal hidden" id="cobro-modal">
      <div class="delete-modal-backdrop" id="cobro-modal-backdrop"></div>
      <div class="delete-modal-content action-sheet-content" id="cobro-modal-content"></div>
    </div>
  `;
}

export function init(s) {
  session = s;
  const params = paramsDesdeHash();
  selectedDate = params.fecha || todayISO();
  agendaFoco = params.agenda;
  const vieneDeAgenda = Boolean(agendaFoco);

  document.getElementById('registros-back').addEventListener('click', () => navigateTo(vieneDeAgenda ? 'agenda' : 'home'));

  // Date picker
  const datePicker = document.getElementById('date-picker');
  datePicker.addEventListener('change', () => {
    selectedDate = datePicker.value;
    loadRegistros();
  });

  // Cerrar modal con backdrop o bot\u00f3n cancelar
  document.getElementById('delete-modal-backdrop').addEventListener('click', closeDeleteModal);
  document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('cobro-modal-backdrop').addEventListener('click', cerrarEditorCobro);

  loadRegistros();
  loadTelefonos();
}

/** Non-blocking: si falla, "Compartir recibo" solo pierde el fallback de
 * wa.me en desktop \u2014 en iOS/Android sigue funcionando v\u00eda el share nativo. */
async function loadTelefonos() {
  if (!session?.sheet_id) return;
  try {
    const res = await getClientas(session.sheet_id);
    telefonosPorClienta = res.telefonos || {};
  } catch {
    /* silencioso */
  }
}

// Estado del modal
let pendingDelete = null;

function openDeleteModal(type, data, displayName) {
  pendingDelete = { type, data };
  document.getElementById('delete-modal-text').textContent =
    `\u00bfEliminar ${type === 'cita' ? 'la cita de' : 'el gasto'} "${displayName}"?`;
  document.getElementById('delete-modal').classList.remove('hidden');

  const confirmBtn = document.getElementById('delete-modal-confirm');
  confirmBtn.onclick = handleConfirmDelete;
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  pendingDelete = null;
}

async function handleConfirmDelete() {
  if (!pendingDelete) return;

  const { type, data } = pendingDelete;
  closeDeleteModal();

  try {
    showLoader();
    if (type === 'cita') {
      await deleteCita(session.sheet_id, data.fecha, data.timestamp, data.clienta);
    } else {
      await deleteGasto(session.sheet_id, data.fecha, data.timestamp, data.descripcion);
    }
    hideLoader();
    // "Deshacer" solo alcanza mientras el toast está visible; el borrado ya
    // se hizo (soft-delete), así que deshacer es restaurarlo, no cancelar
    // una acción pendiente.
    showToast('Registro eliminado', 'success', 5000, {
      label: 'Deshacer',
      onClick: () => undoDelete(type, data),
    });
    loadRegistros();
  } catch (error) {
    hideLoader();
    showToast('Error al eliminar', 'error');
  }
}

async function undoDelete(type, data) {
  try {
    showLoader();
    if (type === 'cita') {
      await restoreCita(session.sheet_id, data.fecha, data.timestamp, data.clienta);
    } else {
      await restoreGasto(session.sheet_id, data.fecha, data.timestamp, data.descripcion);
    }
    hideLoader();
    showToast('Registro restaurado', 'success');
    loadRegistros();
  } catch (error) {
    hideLoader();
    showToast('No se pudo deshacer', 'error');
  }
}

async function loadRegistros() {
  try {
    showLoader();
    const [citasRes, gastosRes] = await Promise.all([
      getCitas(session.sheet_id, selectedDate),
      getGastos(session.sheet_id, selectedDate),
    ]);
    hideLoader();

    const citas = citasRes.citas || [];
    const gastos = gastosRes.gastos || [];

    const totalIngresos = citas.reduce((sum, c) => sum + c.total, 0);
    const totalGastos = gastos.reduce((sum, g) => sum + g.monto, 0);

    document.getElementById('total-ingresos').textContent = formatMXN(totalIngresos);
    document.getElementById('total-gastos').textContent = formatMXN(totalGastos);

    citasActuales = citas;
    renderRegistros(citas, gastos);
    resaltarCobroDeAgenda();
  } catch (error) {
    hideLoader();
    document.getElementById('registros-content').innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar registros</p>
        <button class="btn btn-outline" id="retry-registros" style="max-width: 200px; margin: 0 auto">
          Reintentar
        </button>
      </div>
    `;
    document.getElementById('retry-registros').addEventListener('click', loadRegistros);
  }
}

/** Genera el subt\u00edtulo de una cita con desglose de items */
function buildCitaSubtitle(c) {
  const items = c.items || [];
  if (items.length === 0) return `${escapeHTML(c.metodo_pago)} \u00b7 ${c.timestamp}`;

  const names = items.map((it) => escapeHTML(it.nombre));
  return `${names.join(', ')} \u00b7 ${escapeHTML(c.metodo_pago)} \u00b7 ${c.timestamp}`;
}

/** Letra del badge de cada tipo de item en el desglose */
function badgeLetra(tipo) {
  if (tipo === 'servicio') return 'S';
  if (tipo === 'producto') return 'P';
  return 'A'; // anticipo
}

/** Genera el desglose de items como HTML. Una cita con un solo servicio/
 * producto no necesita desglose (el título ya lo dice todo), pero una fila
 * de solo-anticipo sí: sin esto se vería como un registro vacío. */
function buildItemsBreakdown(items) {
  if (!items || items.length === 0) return '';
  const esSoloAnticipo = items.length === 1 && items[0].tipo === 'anticipo';
  if (items.length <= 1 && !esSoloAnticipo) return '';

  return `
    <div class="record-items-breakdown">
      ${items.map((it) => `
        <div class="record-items-row">
          <span class="record-items-badge record-items-badge--${it.tipo}">
            ${badgeLetra(it.tipo)}
          </span>
          <span class="record-items-name">
            ${escapeHTML(it.nombre)}
            ${it.trabajadora ? `<span class="record-items-worker">${escapeHTML(it.trabajadora)} ${it.pct}%</span>` : ''}
          </span>
          <span class="record-items-cost">${formatMXN(it.costo)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

/** Texto plano del recibo — mismo desglose que la tarjeta, listo para
 * compartir por WhatsApp/iMessage/lo que elija la usuaria en el share sheet. */
function buildMensajeRecibo(c) {
  const salon = session?.salon_nombre || 'El salón';
  const items = (c.items || [])
    .filter((it) => it.tipo !== 'anticipo')
    .map((it) => `• ${it.nombre}: ${formatMXN(it.costo)}`)
    .join('\n');

  let texto = `Recibo — ${salon}\nCliente: ${c.clienta}\nFecha: ${formatDateDisplay(c.fecha)}, ${c.timestamp}`;
  if (items) texto += `\n${items}`;
  if (c.anticipo_aplicado) texto += `\nAnticipo aplicado: −${formatMXN(c.anticipo_aplicado)}`;
  texto += `\nTotal: ${formatMXN(c.total)}\nMétodo de pago: ${c.metodo_pago}\n\n¡Gracias por tu visita!`;
  return texto;
}

/** Línea de "anticipo aplicado" cuando la cita viene de una cita agendada:
 * el total ya se registró neto de ese anticipo, y sin esta línea no se ve
 * de dónde sale la diferencia. */
function buildAnticipoAplicadoRow(c) {
  if (!c.anticipo_aplicado) return '';
  return `<div class="record-anticipo-aplicado">Anticipo aplicado: −${formatMXN(c.anticipo_aplicado)}</div>`;
}

/** Fila de fórmula / nota dentro de la tarjeta de una cita, editable. */
function buildNotaRow(c, index) {
  return `
    <div class="record-nota-row" data-nota-row="${index}">
      ${c.nota
        ? `<span class="visita-nota">${escapeHTML(c.nota)}</span>`
        : '<span class="visita-nota visita-nota--vacia">Sin fórmula anotada</span>'}
      <button class="btn-icon-sm" data-edit-nota="${index}" title="Editar nota" aria-label="Editar nota de ${escapeHTML(c.clienta)}">✎</button>
    </div>
  `;
}

/** Reemplaza la fila de la nota por un editor en línea. */
function abrirEditorNota(index) {
  const c = citasActuales[index];
  const row = document.querySelector(`[data-nota-row="${index}"]`);
  if (!c || !row) return;

  row.innerHTML = `
    <textarea class="input textarea nota-editor" rows="3" maxlength="500"
      placeholder="Ej: Tinte 7.1 + 20 vol, 35 min">${escapeHTML(c.nota || '')}</textarea>
    <div class="step-actions mt-8">
      <button class="btn btn-outline btn-sm" data-cancel>Cancelar</button>
      <button class="btn btn-primary btn-sm" data-save>Guardar</button>
    </div>
  `;

  const textarea = row.querySelector('.nota-editor');
  textarea.focus();

  row.querySelector('[data-cancel]').addEventListener('click', () => loadRegistros());

  row.querySelector('[data-save]').addEventListener('click', async () => {
    const nota = textarea.value.trim();
    try {
      showLoader();
      await updateCitaNota(session.sheet_id, {
        fecha: c.fecha,
        timestamp: c.timestamp,
        clienta: c.clienta,
        nota,
      });
      hideLoader();
      c.nota = nota;
      showToast('Nota guardada', 'success');
      loadRegistros();
    } catch (error) {
      hideLoader();
      showToast('No se pudo guardar la nota', 'error');
    }
  });
}

function renderRegistros(citas, gastos) {
  const content = document.getElementById('registros-content');
  const isToday = selectedDate === todayISO();
  const emptyLabel = isToday ? 'No hay registros para hoy' : `No hay registros para el ${formatDateDisplay(selectedDate)}`;

  if (citas.length === 0 && gastos.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">\ud83d\udced</div>
        <p class="empty-state-text">${emptyLabel}</p>
      </div>
    `;
    return;
  }

  let html = '';

  // Secci\u00f3n Citas
  if (citas.length > 0) {
    html += `
      <div class="records-section">
        <div class="records-section-title">Citas (${citas.length})</div>
        ${citas.map((c, i) => `
          <div class="record-item record-item--expandable" data-cita-index="${i}">
            <div class="record-main-row">
              <div class="record-info">
                <div class="record-title">${escapeHTML(c.clienta)}</div>
                <div class="record-subtitle">${buildCitaSubtitle(c)}</div>
              </div>
              <button class="record-amount record-amount--income record-amount-btn" data-edit-cobro="${i}" title="Corregir cobro" aria-label="Corregir cobro de ${escapeHTML(c.clienta)}: ${formatMXN(c.total)}">
                ${formatMXN(c.total)}<span class="record-amount-edit" aria-hidden="true">✎</span>
              </button>
              <button class="btn-icon-sm" data-share-recibo="${i}" title="Compartir recibo" aria-label="Compartir recibo de ${escapeHTML(c.clienta)}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              </button>
              <button class="record-delete-btn" data-type="cita" data-index="${i}" title="Eliminar" aria-label="Eliminar cita de ${escapeHTML(c.clienta)}">\u00d7</button>
            </div>
            ${buildItemsBreakdown(c.items)}
            ${buildAnticipoAplicadoRow(c)}
            ${buildNotaRow(c, i)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Secci\u00f3n Gastos
  if (gastos.length > 0) {
    html += `
      <div class="records-section">
        <div class="records-section-title">Gastos (${gastos.length})</div>
        ${gastos.map((g, i) => `
          <div class="record-item">
            <div class="record-main-row">
              <div class="record-info">
                <div class="record-title">${escapeHTML(g.descripcion)}</div>
                <div class="record-subtitle">${g.metodo_pago} \u00b7 ${g.timestamp}</div>
              </div>
              <div class="record-amount record-amount--expense">-${formatMXN(g.monto)}</div>
              <button class="record-delete-btn" data-type="gasto" data-index="${i}" title="Eliminar" aria-label="Eliminar gasto: ${escapeHTML(g.descripcion)}">\u00d7</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  content.innerHTML = html;

  // Agregar event listeners a botones de eliminar
  content.querySelectorAll('.record-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const index = parseInt(btn.dataset.index, 10);

      if (type === 'cita') {
        const c = citas[index];
        openDeleteModal('cita', c, c.clienta);
      } else {
        const g = gastos[index];
        openDeleteModal('gasto', g, g.descripcion);
      }
    });
  });

  // Editar la fórmula / nota de una cita
  content.querySelectorAll('[data-edit-nota]').forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirEditorNota(parseInt(btn.dataset.editNota, 10));
    });
  });

  // Corregir el cobro (tocar el monto)
  content.querySelectorAll('[data-edit-cobro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirEditorCobro(parseInt(btn.dataset.editCobro, 10));
    });
  });

  // Compartir recibo por WhatsApp/iMessage
  content.querySelectorAll('[data-share-recibo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = citas[parseInt(btn.dataset.shareRecibo, 10)];
      if (!c) return;
      const telefono = telefonosPorClienta[normalizeNombre(c.clienta)] || '';
      const compartido = await compartirTexto(buildMensajeRecibo(c), telefono);
      // Solo pasa en desktop sin share nativo y sin teléfono guardado —
      // en celular (donde vive esta app) siempre hay share sheet.
      if (!compartido) {
        showToast(`Agrega el teléfono de ${c.clienta} en Clientas para compartir por WhatsApp`, 'error');
      }
    });
  });
}

/** Si se llegó desde la Agenda ("Ver cobro en Registros"), lleva la vista a
 * ese cobro y lo resalta un momento. Solo la primera vez que carga. */
function resaltarCobroDeAgenda() {
  if (!agendaFoco) return;
  const id = agendaFoco;
  agendaFoco = '';
  const index = citasActuales.findIndex((c) => c.agenda_id === id && !esSoloAnticipo(c));
  const card = index === -1 ? null : document.querySelector(`[data-cita-index="${index}"]`);
  if (!card) {
    showToast('No se encontró el cobro de esa cita en este día', 'error');
    return;
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('record-item--foco');
  setTimeout(() => card.classList.remove('record-item--foco'), 2500);
}

// --- Corregir el cobro de una cita ---

/** Lo mismo que hace el servidor (api/citas.js): el anticipo de la cita
 * agendada se vuelve a aplicar sobre el precio nuevo, nunca más de lo que
 * cuesta. Aquí es solo para mostrar el total mientras se escribe. */
function calcularCobro(c, precios) {
  const suma = Math.round(precios.reduce((acc, p) => acc + p, 0) * 100) / 100;
  const anticipoBase = c.anticipo_agenda || c.anticipo_aplicado || 0;
  const anticipo = (c.anticipo_aplicado || c.anticipo_agenda) ? Math.min(anticipoBase, suma) : 0;
  return { anticipo, total: Math.round((suma - anticipo) * 100) / 100 };
}

function cerrarEditorCobro() {
  document.getElementById('cobro-modal').classList.add('hidden');
}

function abrirEditorCobro(index) {
  const c = citasActuales[index];
  if (!c) return;

  // El monto de un anticipo vive en su cita agendada: corregirlo aquí
  // dejaría a las dos diciendo cosas distintas.
  if (esSoloAnticipo(c)) {
    showToast('El anticipo se corrige desde la Agenda, en "Editar anticipo y nota"', 'error', 4000);
    return;
  }

  const items = c.items || [];
  if (items.length === 0) {
    showToast('Este registro no tiene desglose de precios para corregir', 'error');
    return;
  }
  // Un método viejo que ya no existe en la lista se tiene que volver a elegir
  let metodo = METODOS_PAGO.some((m) => m.id === c.metodo_pago) ? c.metodo_pago : '';
  const conComisiones = (session?.trabajadoras || []).length > 0;
  const modal = document.getElementById('cobro-modal');
  const content = document.getElementById('cobro-modal-content');

  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">${escapeHTML(c.clienta)}</span>
      <span class="action-sheet-meta">Corregir cobro · ${escapeHTML(c.timestamp)}</span>
    </div>
    <label class="input-label">${items.length > 1 ? 'Precios' : 'Precio'}</label>
    ${items.map((it, i) => `
      <div class="cobro-item-row">
        <span class="cobro-item-name">
          <span class="record-items-badge record-items-badge--${it.tipo}">${badgeLetra(it.tipo)}</span>
          ${escapeHTML(it.nombre)}
        </span>
        <div class="money-input">
          <input type="text" class="input" data-precio="${i}" inputmode="decimal" autocomplete="off"
            maxlength="10" aria-label="Precio de ${escapeHTML(it.nombre)}" value="${Number(it.costo) || ''}">
        </div>
      </div>
    `).join('')}
    <div class="cobro-linea cobro-linea--anticipo ${calcularCobro(c, items.map((it) => Number(it.costo) || 0)).anticipo > 0 ? '' : 'hidden'}" id="cobro-anticipo">
      <span>Anticipo aplicado</span><span id="cobro-anticipo-valor"></span>
    </div>
    <div class="cobro-linea cobro-linea--total">
      <span>Total cobrado</span><span class="cobro-total-value" id="cobro-total"></span>
    </div>
    <label class="input-label mt-8" for="cobro-metodo">Método de pago</label>
    <select class="input" id="cobro-metodo">
      <option value="" ${metodo ? '' : 'selected'} disabled>Elige…</option>
      ${METODOS_PAGO.map((m) => `<option value="${m.id}" ${metodo === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
    </select>
    ${conComisiones ? '<p class="multi-select-hint anticipo-editor-hint">Si la cita tiene comisiones, se recalculan con el precio nuevo.</p>' : ''}
    <div class="step-actions mt-16">
      <button class="btn btn-outline" id="cobro-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="cobro-guardar">Guardar</button>
    </div>
  `;
  modal.classList.remove('hidden');

  const inputs = [...content.querySelectorAll('[data-precio]')];
  const leerPrecios = () => inputs.map((inp) => (inp.value.trim() === '' ? NaN : Number(inp.value)));

  const actualizarTotal = () => {
    const precios = leerPrecios().map((p) => (Number.isFinite(p) ? p : 0));
    const { anticipo, total } = calcularCobro(c, precios);
    document.getElementById('cobro-total').textContent = formatMXN(total);
    document.getElementById('cobro-anticipo-valor').textContent = `−${formatMXN(anticipo)}`;
    document.getElementById('cobro-anticipo').classList.toggle('hidden', !(anticipo > 0));
  };
  actualizarTotal();

  inputs.forEach((inp) => {
    inp.addEventListener('input', () => {
      // Solo dígitos y un punto con hasta 2 decimales
      const limpio = inp.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2})\d+$/, '$1');
      if (limpio !== inp.value) inp.value = limpio;
      actualizarTotal();
    });
  });

  document.getElementById('cobro-metodo').addEventListener('change', (e) => {
    metodo = e.target.value;
  });

  document.getElementById('cobro-cancelar').addEventListener('click', cerrarEditorCobro);
  document.getElementById('cobro-guardar').addEventListener('click', async () => {
    const precios = leerPrecios();
    const malo = precios.findIndex((p) => !Number.isFinite(p) || p <= 0 || p > 1_000_000);
    if (malo !== -1) {
      showToast(`Escribe el precio de ${items[malo].nombre}`, 'error');
      inputs[malo].focus();
      return;
    }
    if (!metodo) {
      showToast('Elige el método de pago', 'error');
      return;
    }

    const sinCambios = metodo === c.metodo_pago
      && precios.every((p, i) => Math.round(p * 100) === Math.round(Number(items[i].costo) * 100));
    if (sinCambios) {
      cerrarEditorCobro();
      return;
    }

    try {
      showLoader();
      const res = await updateCobro(session.sheet_id, {
        fecha: c.fecha,
        timestamp: c.timestamp,
        clienta: c.clienta,
        items: items.map((it, i) => ({ tipo: it.tipo, nombre: it.nombre, costo: Math.round(precios[i] * 100) / 100 })),
        metodo_pago: metodo,
      });
      hideLoader();
      cerrarEditorCobro();
      showToast(`Cobro corregido: ${formatMXN(res.total)}`, 'success');
      loadRegistros();
    } catch (error) {
      hideLoader();
      showToast(error.message || 'No se pudo corregir el cobro', 'error');
    }
  });
}
