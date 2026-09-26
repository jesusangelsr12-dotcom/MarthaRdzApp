/**
 * Pantalla Historial de Clientas
 *
 * Busca una clienta y muestra sus visitas con la fórmula usada en cada una.
 * Todo se carga en UNA sola llamada al abrir la pantalla y el filtrado ocurre
 * en el navegador, para que escribir el nombre dé resultados al instante.
 *
 * Detalles pensados para dar el mínimo de clics:
 * - La fórmula más reciente se ve en la tarjeta cerrada, sin abrir nada.
 * - Si la búsqueda deja una sola clienta, se abre sola.
 */

import { getHistorial, updateCitaNota, saveNotaFija } from '../api.js';
import { formatMXN, showToast, showLoader, hideLoader, escapeHTML, normalizeNombre, loadingHTML } from '../utils.js';
import { navigateTo } from '../app.js';

let session = null;
let allClientas = [];
let query = '';
let expandedKeys = new Set();

const MAX_RESULTADOS = 20;
const RECIENTES_SIN_BUSQUEDA = 15;

/** "2026-07-12" → "12 jul 2026" */
function formatFechaCorta(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T12:00:00');
  if (isNaN(d)) return fechaISO;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function render(s) {
  session = s;
  return `
    <div class="screen" id="historial-screen">
      <header class="screen-header">
        <button class="header-back" id="historial-back">← Atrás</button>
        <h2 class="screen-title">Clientas</h2>
      </header>

      <input type="text" class="input" id="historial-search"
        placeholder="Buscar clienta..." autocomplete="off" autocapitalize="off">

      <div id="historial-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando clientas...')}
        </div>
      </div>
    </div>
  `;
}

export function init(s) {
  session = s;
  allClientas = [];
  query = '';
  expandedKeys = new Set();

  document.getElementById('historial-back').addEventListener('click', () => navigateTo('home'));

  const search = document.getElementById('historial-search');
  search.addEventListener('input', () => {
    query = search.value;
    renderLista();
  });

  loadHistorial();
}

async function loadHistorial() {
  try {
    showLoader();
    const res = await getHistorial(session.sheet_id);
    hideLoader();
    allClientas = res.clientas || [];
    renderLista();
  } catch (error) {
    hideLoader();
    document.getElementById('historial-content').innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar las clientas</p>
        <button class="btn btn-outline" id="retry-historial" style="max-width: 200px; margin: 0 auto">
          Reintentar
        </button>
      </div>
    `;
    document.getElementById('retry-historial').addEventListener('click', loadHistorial);
  }
}

/** Clientas que coinciden con la búsqueda actual. */
function filtrar() {
  const q = normalizeNombre(query);
  if (!q) return allClientas.slice(0, RECIENTES_SIN_BUSQUEDA);
  return allClientas.filter((c) => c.key.includes(q)).slice(0, MAX_RESULTADOS);
}

function renderLista() {
  const content = document.getElementById('historial-content');
  const resultados = filtrar();
  const buscando = normalizeNombre(query).length > 0;

  if (allClientas.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">👥</div>
        <p class="empty-state-text">Todavía no hay clientas registradas</p>
      </div>
    `;
    return;
  }

  if (resultados.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">🔍</div>
        <p class="empty-state-text">Ninguna clienta coincide con "${escapeHTML(query)}"</p>
      </div>
    `;
    return;
  }

  // Si la búsqueda deja una sola clienta, abrirla sola
  if (buscando && resultados.length === 1) {
    expandedKeys.add(resultados[0].key);
  }

  content.innerHTML = `
    <p class="historial-hint">
      ${buscando
        ? `${resultados.length} resultado${resultados.length !== 1 ? 's' : ''}`
        : 'Clientas más recientes · escribe para buscar'}
    </p>
    <div class="historial-list">
      ${resultados.map(renderTarjeta).join('')}
    </div>
  `;

  attachListeners();
}

function renderTarjeta(c) {
  const abierta = expandedKeys.has(c.key);
  // La fórmula más reciente se ve sin abrir la tarjeta
  const ultimaNota = (c.visitas.find((v) => v.nota) || {}).nota || '';

  return `
    <div class="clienta-card ${abierta ? 'expanded' : ''}" data-key="${escapeHTML(c.key)}">
      <div class="clienta-card-head" data-toggle="${escapeHTML(c.key)}">
        <div class="clienta-card-info">
          <div class="clienta-card-name">
            ${escapeHTML(c.nombre)}
            ${c.nota_fija ? '<span class="clienta-pill">Nota</span>' : ''}
          </div>
          <div class="clienta-card-meta">
            ${c.total_visitas} visita${c.total_visitas !== 1 ? 's' : ''}${
              c.ultima_visita ? ` · última: ${formatFechaCorta(c.ultima_visita)}` : ''
            }
          </div>
          ${!abierta && ultimaNota ? `
            <div class="clienta-card-formula">${escapeHTML(ultimaNota)}</div>
          ` : ''}
        </div>
        <div class="clienta-card-total">${formatMXN(c.total_gastado)}</div>
      </div>

      <div class="clienta-detail ${abierta ? '' : 'hidden'}">
        <div class="telefono-block" data-telefono-block="${escapeHTML(c.key)}">
          ${renderTelefono(c)}
        </div>

        <div class="nota-fija-block" data-nota-fija="${escapeHTML(c.key)}">
          ${renderNotaFija(c)}
        </div>

        ${c.visitas.length === 0 ? `
          <p class="historial-hint">Sin visitas registradas todavía</p>
        ` : `
          <div class="visitas-list">
            ${c.visitas.map((v, i) => renderVisita(c, v, i)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

/** "4421234567" → "442 123 4567" (solo para mostrar, se guarda sin espacios) */
function formatTelefono(tel) {
  if (!tel || tel.length !== 10) return tel || '';
  return `${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6)}`;
}

function renderTelefono(c) {
  if (!c.telefono) {
    return `<button class="btn-link" data-edit-telefono="${escapeHTML(c.key)}">+ Agregar teléfono</button>`;
  }
  return `
    <div class="telefono-row">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
      <span class="telefono-text">${escapeHTML(formatTelefono(c.telefono))}</span>
      <button class="btn-icon-sm" data-edit-telefono="${escapeHTML(c.key)}" title="Editar" aria-label="Editar teléfono de ${escapeHTML(c.nombre)}">✎</button>
    </div>
  `;
}

function renderNotaFija(c) {
  if (!c.nota_fija) {
    return `
      <button class="btn-link" data-edit-fija="${escapeHTML(c.key)}">+ Agregar nota fija</button>
    `;
  }
  return `
    <div class="nota-fija-banner">
      <span class="nota-fija-banner-label">Nota fija</span>
      <span class="nota-fija-banner-text">${escapeHTML(c.nota_fija)}</span>
    </div>
    <button class="btn-link" data-edit-fija="${escapeHTML(c.key)}">Editar nota fija</button>
  `;
}

function renderVisita(c, v, i) {
  const items = (v.items || []).map((it) => it.nombre).filter(Boolean).join(', ');
  return `
    <div class="visita-row" data-visita="${escapeHTML(c.key)}|${i}">
      <div class="visita-head">
        <span class="visita-fecha">${formatFechaCorta(v.fecha)}</span>
        <span class="visita-total">${formatMXN(v.total)}</span>
      </div>
      ${items ? `<div class="visita-items">${escapeHTML(items)}</div>` : ''}
      <div class="visita-nota-row">
        ${v.nota
          ? `<span class="visita-nota">${escapeHTML(v.nota)}</span>`
          : '<span class="visita-nota visita-nota--vacia">Sin fórmula anotada</span>'}
        <button class="btn-icon-sm" data-edit-nota="${escapeHTML(c.key)}|${i}" title="Editar" aria-label="Editar nota de la visita del ${formatFechaCorta(v.fecha)}">✎</button>
      </div>
    </div>
  `;
}

function attachListeners() {
  const content = document.getElementById('historial-content');

  // Abrir / cerrar tarjeta
  content.querySelectorAll('[data-toggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const key = head.dataset.toggle;
      if (expandedKeys.has(key)) expandedKeys.delete(key);
      else expandedKeys.add(key);
      renderLista();
    });
  });

  // Editar la nota de una visita
  content.querySelectorAll('[data-edit-nota]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [key, idx] = btn.dataset.editNota.split('|');
      abrirEditorVisita(key, parseInt(idx, 10));
    });
  });

  // Editar la nota fija
  content.querySelectorAll('[data-edit-fija]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirEditorNotaFija(btn.dataset.editFija);
    });
  });

  // Editar el teléfono
  content.querySelectorAll('[data-edit-telefono]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirEditorTelefono(btn.dataset.editTelefono);
    });
  });
}

function findClienta(key) {
  return allClientas.find((c) => c.key === key);
}

/** Reemplaza una visita por un editor en línea. */
function abrirEditorVisita(key, idx) {
  const c = findClienta(key);
  if (!c) return;
  const v = c.visitas[idx];
  const row = document.querySelector(`[data-visita="${CSS.escape(key)}|${idx}"]`);
  if (!row || !v) return;

  row.innerHTML = `
    <div class="visita-head">
      <span class="visita-fecha">${formatFechaCorta(v.fecha)}</span>
      <span class="visita-total">${formatMXN(v.total)}</span>
    </div>
    <textarea class="input textarea nota-editor" rows="3" maxlength="500"
      placeholder="Ej: Tinte 7.1 + 20 vol, 35 min">${escapeHTML(v.nota)}</textarea>
    <div class="step-actions mt-8">
      <button class="btn btn-outline btn-sm" data-cancel>Cancelar</button>
      <button class="btn btn-primary btn-sm" data-save>Guardar</button>
    </div>
  `;

  const textarea = row.querySelector('.nota-editor');
  textarea.focus();

  row.querySelector('[data-cancel]').addEventListener('click', (e) => {
    e.stopPropagation();
    renderLista();
  });

  row.querySelector('[data-save]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const nota = textarea.value.trim();
    try {
      showLoader();
      await updateCitaNota(session.sheet_id, {
        fecha: v.fecha,
        timestamp: v.timestamp,
        // Nombre exacto de la hoja: sin esto la fila no se encuentra
        clienta: v.clienta_raw,
        nota,
      });
      hideLoader();
      v.nota = nota;          // actualizar en memoria, sin recargar todo
      renderLista();
      showToast('Nota guardada', 'success');
    } catch (error) {
      hideLoader();
      showToast('No se pudo guardar la nota', 'error');
    }
  });
}

/** Editor en línea de la nota fija de la clienta. */
function abrirEditorNotaFija(key) {
  const c = findClienta(key);
  if (!c) return;
  const block = document.querySelector(`[data-nota-fija="${CSS.escape(key)}"]`);
  if (!block) return;

  block.innerHTML = `
    <label class="input-label">Nota fija de ${escapeHTML(c.nombre)}</label>
    <p class="multi-select-hint">Alergias, preferencias... siempre visible en su historial</p>
    <textarea class="input textarea nota-editor" rows="3" maxlength="500"
      placeholder="Ej: Alérgica al amoniaco">${escapeHTML(c.nota_fija)}</textarea>
    <div class="step-actions mt-8">
      <button class="btn btn-outline btn-sm" data-cancel>Cancelar</button>
      <button class="btn btn-primary btn-sm" data-save>Guardar</button>
    </div>
  `;

  const textarea = block.querySelector('.nota-editor');
  textarea.focus();

  block.querySelector('[data-cancel]').addEventListener('click', (e) => {
    e.stopPropagation();
    renderLista();
  });

  block.querySelector('[data-save]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const nota = textarea.value.trim();
    try {
      showLoader();
      await saveNotaFija(session.sheet_id, c.nombre, nota, c.telefono);
      hideLoader();
      c.nota_fija = nota;     // actualizar en memoria
      renderLista();
      showToast('Nota fija guardada', 'success');
    } catch (error) {
      hideLoader();
      showToast('No se pudo guardar la nota', 'error');
    }
  });
}

/** Editor en línea del teléfono de la clienta — base de "Compartir/Confirmar
 * por WhatsApp": sin celular guardado, esos botones no tienen a quién
 * mandarle el mensaje. */
function abrirEditorTelefono(key) {
  const c = findClienta(key);
  if (!c) return;
  const block = document.querySelector(`[data-telefono-block="${CSS.escape(key)}"]`);
  if (!block) return;

  block.innerHTML = `
    <label class="input-label">Teléfono de ${escapeHTML(c.nombre)}</label>
    <p class="multi-select-hint">10 dígitos — para mandarle confirmaciones y recibos por WhatsApp</p>
    <input type="tel" class="input" id="telefono-editor" inputmode="numeric"
      autocomplete="tel-national" maxlength="10" placeholder="4421234567" value="${escapeHTML(c.telefono)}">
    <div class="step-actions mt-8">
      <button class="btn btn-outline btn-sm" data-cancel>Cancelar</button>
      <button class="btn btn-primary btn-sm" data-save>Guardar</button>
    </div>
  `;

  const input = block.querySelector('#telefono-editor');
  input.focus();
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 10);
  });

  block.querySelector('[data-cancel]').addEventListener('click', (e) => {
    e.stopPropagation();
    renderLista();
  });

  block.querySelector('[data-save]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const telefono = input.value.trim();
    if (telefono && telefono.length !== 10) {
      showToast('El teléfono debe tener 10 dígitos', 'error');
      return;
    }
    try {
      showLoader();
      await saveNotaFija(session.sheet_id, c.nombre, c.nota_fija, telefono);
      hideLoader();
      c.telefono = telefono;  // actualizar en memoria
      renderLista();
      showToast('Teléfono guardado', 'success');
    } catch (error) {
      hideLoader();
      showToast('No se pudo guardar el teléfono', 'error');
    }
  });
}
