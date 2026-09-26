/**
 * Pantalla Reporte de Comisiones
 * Suma las comisiones por trabajadora en un rango de fechas.
 * Lee la hoja "Comisiones" del salón.
 */

import { getComisiones } from '../api.js';
import { formatMXN, currentWeekRange, showLoader, hideLoader, escapeHTML, loadingHTML } from '../utils.js';
import { navigateTo } from '../app.js';

let session = null;
let desde = '';
let hasta = '';

export function render(s) {
  session = s;
  ({ desde, hasta } = currentWeekRange());
  return `
    <div class="screen" id="comisiones-screen">
      <header class="screen-header">
        <button class="header-back" id="comisiones-back">← Atrás</button>
        <h2 class="screen-title">Comisiones</h2>
      </header>

      <div class="range-picker-row">
        <div class="range-picker-field">
          <label class="range-picker-label">Desde</label>
          <input type="date" class="date-picker-input" id="fecha-desde" value="${desde}">
        </div>
        <div class="range-picker-field">
          <label class="range-picker-label">Hasta</label>
          <input type="date" class="date-picker-input" id="fecha-hasta" value="${hasta}">
        </div>
      </div>

      <div class="totals-bar totals-bar--single">
        <div class="total-card">
          <div class="total-card-label">Total comisiones</div>
          <div class="total-card-value total-card-value--income" id="total-comisiones">$0.00</div>
        </div>
      </div>

      <div id="comisiones-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando comisiones...')}
        </div>
      </div>
    </div>
  `;
}

export function init(s) {
  session = s;
  ({ desde, hasta } = currentWeekRange());

  document.getElementById('comisiones-back').addEventListener('click', () => navigateTo('home'));

  const inputDesde = document.getElementById('fecha-desde');
  const inputHasta = document.getElementById('fecha-hasta');
  inputDesde.addEventListener('change', () => { desde = inputDesde.value; loadComisiones(); });
  inputHasta.addEventListener('change', () => { hasta = inputHasta.value; loadComisiones(); });

  loadComisiones();
}

/** Agrupa las comisiones por trabajadora */
function agruparPorTrabajadora(comisiones) {
  const map = {};
  for (const c of comisiones) {
    const key = c.trabajadora || 'Sin asignar';
    if (!map[key]) {
      map[key] = { trabajadora: key, total: 0, cantidad: 0, servicios: 0, productos: 0, items: [] };
    }
    const g = map[key];
    g.total += c.comision;
    g.cantidad += 1;
    if (c.tipo === 'producto') g.productos += c.comision;
    else g.servicios += c.comision;
    g.items.push(c);
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

async function loadComisiones() {
  const content = document.getElementById('comisiones-content');

  if (desde > hasta) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">⚠️</div>
        <p class="empty-state-text">La fecha "Desde" no puede ser mayor que "Hasta"</p>
      </div>
    `;
    document.getElementById('total-comisiones').textContent = formatMXN(0);
    return;
  }

  try {
    showLoader();
    const res = await getComisiones(session.sheet_id, desde, hasta);
    hideLoader();

    const comisiones = res.comisiones || [];
    const totalGeneral = comisiones.reduce((sum, c) => sum + c.comision, 0);
    document.getElementById('total-comisiones').textContent = formatMXN(totalGeneral);

    renderReporte(agruparPorTrabajadora(comisiones));
  } catch (error) {
    hideLoader();
    content.innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar comisiones</p>
        <button class="btn btn-outline" id="retry-comisiones" style="max-width: 200px; margin: 0 auto">
          Reintentar
        </button>
      </div>
    `;
    document.getElementById('retry-comisiones').addEventListener('click', loadComisiones);
  }
}

function renderReporte(grupos) {
  const content = document.getElementById('comisiones-content');

  if (grupos.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">💸</div>
        <p class="empty-state-text">No hay comisiones en este periodo</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="records-section">
      <div class="records-section-title">Por trabajadora (${grupos.length})</div>
      ${grupos.map((g, i) => `
        <div class="comision-report-card" data-index="${i}">
          <div class="comision-report-head">
            <div class="comision-report-info">
              <div class="comision-report-name">${escapeHTML(g.trabajadora)}</div>
              <div class="comision-report-meta">
                ${g.cantidad} comisión${g.cantidad !== 1 ? 'es' : ''} ·
                Serv: ${formatMXN(g.servicios)} · Prod: ${formatMXN(g.productos)}
              </div>
            </div>
            <div class="comision-report-total">${formatMXN(g.total)}</div>
          </div>
          <div class="comision-report-detail hidden" id="detalle-${i}">
            ${g.items.map((c) => `
              <div class="comision-report-line">
                <span class="comision-report-line-name">
                  ${escapeHTML(c.item)}
                  <span class="comision-report-line-sub">${escapeHTML(c.clienta)} · ${c.fecha} · ${c.pct}%</span>
                </span>
                <span class="comision-report-line-amount">${formatMXN(c.comision)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Expandir / colapsar detalle al tocar la tarjeta
  content.querySelectorAll('.comision-report-card').forEach((card) => {
    card.addEventListener('click', () => {
      const detalle = card.querySelector('.comision-report-detail');
      detalle.classList.toggle('hidden');
      card.classList.toggle('expanded');
    });
  });
}
