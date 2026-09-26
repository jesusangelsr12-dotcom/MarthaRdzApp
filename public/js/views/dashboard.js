/**
 * Pantalla Dashboard
 * Resumen del negocio de un mes — siempre arranca en el mes en curso, con
 * un selector para ver un mes anterior completo (nunca uno futuro).
 *
 * El rango de fechas exacto se imprime siempre en pantalla para que la
 * usuaria pueda validar qué periodo está viendo.
 */

import { getDashboard } from '../api.js';
import { formatMXN, todayISO, showLoader, hideLoader, escapeHTML, formatRangoFecha, loadingHTML } from '../utils.js';
import { navigateTo } from '../app.js';

let session = null;
let mesSeleccionado = ''; // YYYY-MM — siempre arranca en el mes en curso

/** Mes actual en formato YYYY-MM */
function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Rango de fechas de un mes (YYYY-MM). Si es el mes en curso, llega hasta
 * hoy (los días que faltan del mes no tienen datos todavía); si es un mes
 * pasado, llega hasta su último día — ya está completo.
 */
function monthRange(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const desde = `${yearMonth}-01`;
  if (yearMonth === currentYearMonth()) {
    return { desde, hasta: todayISO() };
  }
  const ultimoDia = new Date(year, month, 0).getDate();
  return { desde, hasta: `${yearMonth}-${String(ultimoDia).padStart(2, '0')}` };
}

/** "2026-09-05" → "5 sep" (etiquetas del gráfico) */
function formatFechaCorta(fechaISO) {
  const d = new Date(fechaISO + 'T12:00:00');
  if (isNaN(d)) return fechaISO;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function render(s) {
  session = s;
  mesSeleccionado = currentYearMonth();
  return `
    <div class="screen" id="dashboard-screen">
      <header class="screen-header">
        <button class="header-back" id="dashboard-back">← Atrás</button>
        <h2 class="screen-title">Dashboard</h2>
      </header>

      <div class="range-picker-row range-picker-row--single">
        <div class="range-picker-field">
          <label class="range-picker-label">Mes</label>
          <input type="month" class="date-picker-input" id="mes-selector"
            value="${mesSeleccionado}" max="${currentYearMonth()}">
        </div>
      </div>

      <div id="dashboard-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando dashboard...')}
        </div>
      </div>
    </div>
  `;
}

export function init(s) {
  session = s;
  mesSeleccionado = currentYearMonth();

  document.getElementById('dashboard-back').addEventListener('click', () => navigateTo('home'));

  const mesInput = document.getElementById('mes-selector');
  mesInput.addEventListener('change', () => {
    if (!mesInput.value) return;
    mesSeleccionado = mesInput.value;
    load();
  });

  load();
}

async function load() {
  const content = document.getElementById('dashboard-content');
  const { desde: desdeMes, hasta: hastaMes } = monthRange(mesSeleccionado);

  try {
    showLoader();
    const dataMes = await getDashboard(session.sheet_id, desdeMes, hastaMes);
    hideLoader();
    renderContent(dataMes, { desdeMes, hastaMes });
  } catch (error) {
    hideLoader();
    content.innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar el dashboard</p>
        <button class="btn btn-outline" id="retry-dashboard" style="max-width: 200px; margin: 0 auto">
          Reintentar
        </button>
      </div>
    `;
    document.getElementById('retry-dashboard').addEventListener('click', load);
  }
}

function renderContent(dataMes, rangos) {
  const content = document.getElementById('dashboard-content');
  const { resumen, serie_diaria, top_servicios, top_productos, top_clientas } = dataMes;

  if (resumen.num_citas === 0 && resumen.num_gastos === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">📊</div>
        <p class="empty-state-text">No hay registros este mes (${formatRangoFecha(rangos.desdeMes, rangos.hastaMes)})</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <p class="dashboard-rango">${formatRangoFecha(rangos.desdeMes, rangos.hastaMes)}</p>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-card-label">Ingresos</div>
        <div class="kpi-card-value kpi-card-value--income">${formatMXN(resumen.ingresos)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-label">Gastos</div>
        <div class="kpi-card-value kpi-card-value--expense">${formatMXN(resumen.gastos)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-label">Comisiones</div>
        <div class="kpi-card-value kpi-card-value--neutral">${formatMXN(resumen.comisiones)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-label">Ganancia neta</div>
        <div class="kpi-card-value ${resumen.utilidad_neta >= 0 ? 'kpi-card-value--income' : 'kpi-card-value--expense'}">${formatMXN(resumen.utilidad_neta)}</div>
      </div>
    </div>

    <p class="historial-hint">${resumen.num_citas} cita${resumen.num_citas !== 1 ? 's' : ''} · ${resumen.num_gastos} gasto${resumen.num_gastos !== 1 ? 's' : ''} registrados</p>

    ${buildChart(serie_diaria)}

    ${buildRanking('Servicios más vendidos', top_servicios, 'vendido')}
    ${buildRanking('Productos más vendidos', top_productos, 'vendido')}
    ${buildRanking('Clientas de mayor gasto', top_clientas.map((c) => ({ nombre: c.nombre, cantidad: c.visitas, total: c.total })), 'visita')}
  `;
}

function buildChart(serie) {
  if (serie.length === 0) return '';

  const maxValor = Math.max(1, ...serie.map((d) => Math.max(d.ingresos, d.gastos)));
  const ALTO = 120;

  return `
    <div class="records-section">
      <div class="records-section-title">Ingresos vs. gastos por día</div>
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="chart-legend-dot chart-legend-dot--income"></span>Ingresos</span>
        <span class="chart-legend-item"><span class="chart-legend-dot chart-legend-dot--expense"></span>Gastos</span>
      </div>
      <div class="chart-scroll">
        <div class="chart-bars">
          ${serie.map((d) => `
            <div class="chart-bar-col" title="${formatFechaCorta(d.fecha)}: ${formatMXN(d.ingresos)} / ${formatMXN(d.gastos)}">
              <div class="chart-bar-pair" style="height: ${ALTO}px">
                <div class="chart-bar chart-bar--ingreso" style="height: ${Math.round((d.ingresos / maxValor) * 100)}%"></div>
                <div class="chart-bar chart-bar--gasto" style="height: ${Math.round((d.gastos / maxValor) * 100)}%"></div>
              </div>
              <span class="chart-bar-label">${formatFechaCorta(d.fecha)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function buildRanking(titulo, items, etiquetaCantidad) {
  if (items.length === 0) return '';

  return `
    <div class="records-section">
      <div class="records-section-title">${titulo}</div>
      ${items.map((it, i) => `
        <div class="rank-row">
          <span class="rank-position">${i + 1}</span>
          <div class="rank-info">
            <span class="rank-name">${escapeHTML(it.nombre)}</span>
            <span class="rank-meta">${it.cantidad} ${etiquetaCantidad}${it.cantidad !== 1 ? 's' : ''}</span>
          </div>
          <span class="rank-value">${formatMXN(it.total)}</span>
        </div>
      `).join('')}
    </div>
  `;
}
