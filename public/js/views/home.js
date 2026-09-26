/**
 * Pantalla Home
 * Header con saludo + nombre del salón + una tarjeta de resumen (semana en
 * curso: ingresos/citas/gastos como mini-estadísticas, comisiones por
 * trabajadora) + acciones principales (las 4 que más se usan) + "Más"
 * (las que se usan poco, colapsado hasta que se toca) + cerrar sesión.
 */

import { logout, isTrabajadora } from '../auth.js';
import { navigateTo } from '../app.js';
import { getDashboard, getComisiones } from '../api.js';
import { formatMXN, escapeHTML, currentWeekRange, formatRangoFecha, loadingHTML } from '../utils.js';
import { shouldShowInstallBanner, installBannerHTML, initInstallBanner } from '../install-banner.js';
import { versionAppHTML, pintarVersionApp, actualizarApp } from '../app-version.js';

let session = null;

/**
 * Home reducido para una trabajadora: sin dinero agregado ni "Más" — solo
 * lo que le toca hacer (ver la agenda, registrar/cobrar una cita) y salir.
 * Lleva aquí "Actualizar app" porque ella no entra a Configuración.
 */
function renderTrabajadora() {
  const nombre = session?.salon_nombre || 'Mi Salón';
  return `
    <div class="screen">
      <header class="home-header home-header--logo">
        <img class="home-logo" src="/img/logo.png" alt="${escapeHTML(nombre)}">
      </header>

      ${shouldShowInstallBanner() ? installBannerHTML() : ''}

      <div class="home-actions">
        <button class="home-action-card" id="btn-agenda">
          <div class="home-action-icon home-action-icon--rose">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div class="home-action-text">
            <span class="home-action-label">Agenda</span>
            <span class="home-action-desc">Citas futuras y anticipos</span>
          </div>
        </button>

        <button class="home-action-card" id="btn-cita">
          <div class="home-action-icon home-action-icon--primary">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="home-action-text">
            <span class="home-action-label">Registrar Cita</span>
            <span class="home-action-desc">Nueva o cobrar agendada</span>
          </div>
        </button>
      </div>

      <div class="home-footer">
        <button class="btn-logout" id="btn-logout">
          Cerrar sesión
        </button>
        ${versionAppHTML()}
      </div>
    </div>
  `;
}

function initTrabajadora() {
  initInstallBanner();
  pintarVersionApp();
  document.querySelector('[data-action="actualizar-app"]').addEventListener('click', actualizarApp);
  document.getElementById('btn-cita').addEventListener('click', () => navigateTo('cita'));
  document.getElementById('btn-agenda').addEventListener('click', () => navigateTo('agenda'));
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    navigateTo('login');
  });
}

/** Suma las comisiones de la semana por trabajadora, de mayor a menor. */
function agruparComisionesPorTrabajadora(comisiones) {
  const map = {};
  for (const c of comisiones) {
    const key = c.trabajadora || 'Sin asignar';
    map[key] = (map[key] || 0) + c.comision;
  }
  return Object.entries(map)
    .map(([trabajadora, total]) => ({ trabajadora, total }))
    .sort((a, b) => b.total - a.total);
}

// Colores de los "avatares" de comisiones, en ciclo — solo un toque de
// personalidad para diferenciar trabajadoras a simple vista.
const AVATAR_COLORES = ['pink', 'rose', 'ink'];

// Iconos de cada acción secundaria ("Más"), reutilizados tal cual estaban.
const ICONOS_MAS = {
  registros: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  comisiones: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  dashboard: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};

export function render(s) {
  session = s;
  if (isTrabajadora()) return renderTrabajadora();

  const nombre = session?.salon_nombre || 'Mi Salón';
  const { desde, hasta } = currentWeekRange();

  return `
    <div class="screen">
      <header class="home-header home-header--logo">
        <img class="home-logo" src="/img/logo.png" alt="${escapeHTML(nombre)}">
      </header>

      ${shouldShowInstallBanner() ? installBannerHTML() : ''}

      <div class="home-grid">
        <div class="home-grid-col">
          <div class="home-resumen-card" id="home-resumen-card">
            <p class="home-resumen-rango">Semana del ${formatRangoFecha(desde, hasta)}</p>
            <div class="home-stats-grid" id="home-summary">
              ${loadingHTML('Cargando resumen...')}
            </div>
            <div id="home-comisiones-semana"></div>
          </div>

          <div class="home-actions">
            <button class="home-action-card" id="btn-agenda">
              <div class="home-action-icon home-action-icon--rose">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div class="home-action-text">
                <span class="home-action-label">Agenda</span>
                <span class="home-action-desc">Citas futuras y anticipos</span>
              </div>
            </button>

            <button class="home-action-card" id="btn-cita">
              <div class="home-action-icon home-action-icon--primary">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div class="home-action-text">
                <span class="home-action-label">Registrar Cita</span>
                <span class="home-action-desc">Servicios y productos</span>
              </div>
            </button>

            <button class="home-action-card" id="btn-gasto">
              <div class="home-action-icon home-action-icon--warning">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <div class="home-action-text">
                <span class="home-action-label">Registrar Gasto</span>
                <span class="home-action-desc">Gastos operativos</span>
              </div>
            </button>

            <button class="home-action-card" id="btn-historial">
              <div class="home-action-icon home-action-icon--neutral">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <div class="home-action-text">
                <span class="home-action-label">Clientas</span>
                <span class="home-action-desc">Historial y fórmulas</span>
              </div>
            </button>
          </div>
        </div>

        <div class="home-grid-col">
          <div class="home-mas">
            <button class="home-mas-toggle" id="home-mas-toggle" aria-expanded="false" aria-controls="home-mas-list">
              <span class="home-mas-title">Más</span>
              <svg class="home-mas-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="home-mas-list hidden" id="home-mas-list">
              <button class="home-action-card home-action-card--sm" id="btn-registros">
                <div class="home-action-icon home-action-icon--success">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_MAS.registros}</svg>
                </div>
                <span class="home-action-label">Ver Registros</span>
              </button>

              <button class="home-action-card home-action-card--sm" id="btn-comisiones">
                <div class="home-action-icon home-action-icon--rose">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_MAS.comisiones}</svg>
                </div>
                <span class="home-action-label">Comisiones</span>
              </button>

              <button class="home-action-card home-action-card--sm" id="btn-dashboard">
                <div class="home-action-icon home-action-icon--dashboard">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_MAS.dashboard}</svg>
                </div>
                <span class="home-action-label">Dashboard</span>
              </button>

              <button class="home-action-card home-action-card--sm" id="btn-config">
                <div class="home-action-icon home-action-icon--muted">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_MAS.config}</svg>
                </div>
                <span class="home-action-label">Configuración</span>
              </button>
            </div>
          </div>

          <div class="home-footer">
            <button class="btn-logout" id="btn-logout">
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function init(s) {
  session = s;
  if (isTrabajadora()) return initTrabajadora();

  initInstallBanner();

  document.getElementById('btn-cita').addEventListener('click', () => navigateTo('cita'));
  document.getElementById('btn-agenda').addEventListener('click', () => navigateTo('agenda'));
  document.getElementById('btn-historial').addEventListener('click', () => navigateTo('historial'));
  document.getElementById('btn-gasto').addEventListener('click', () => navigateTo('gasto'));
  document.getElementById('btn-registros').addEventListener('click', () => navigateTo('registros'));
  document.getElementById('btn-comisiones').addEventListener('click', () => navigateTo('comisiones'));
  document.getElementById('btn-dashboard').addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('btn-config').addEventListener('click', () => navigateTo('config'));

  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    navigateTo('login');
  });

  // "Más" empieza colapsado: son las opciones que se usan poco, no deben
  // ocupar espacio hasta que la usuaria las pida.
  const masToggle = document.getElementById('home-mas-toggle');
  const masList = document.getElementById('home-mas-list');
  masToggle.addEventListener('click', () => {
    const abierto = masToggle.getAttribute('aria-expanded') === 'true';
    masToggle.setAttribute('aria-expanded', String(!abierto));
    masToggle.classList.toggle('home-mas-toggle--open', !abierto);
    masList.classList.toggle('hidden', abierto);
  });

  // Cargar resumen de la semana (non-blocking)
  loadWeeklySummary();
}

async function loadWeeklySummary() {
  const resumenCard = document.getElementById('home-resumen-card');
  const summaryEl = document.getElementById('home-summary');
  const comisionesEl = document.getElementById('home-comisiones-semana');
  if (!session?.sheet_id) {
    resumenCard.style.display = 'none';
    return;
  }

  const { desde, hasta } = currentWeekRange();

  try {
    const [dataSemana, comisionesRes] = await Promise.all([
      getDashboard(session.sheet_id, desde, hasta),
      getComisiones(session.sheet_id, desde, hasta),
    ]);

    const { resumen } = dataSemana;

    summaryEl.innerHTML = `
      <div class="home-stat">
        <div class="home-stat-icon home-stat-icon--income">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
        <span class="home-stat-value home-stat-value--income">${formatMXN(resumen.ingresos)}</span>
        <span class="home-stat-label">ingresos</span>
      </div>
      <div class="home-stat">
        <div class="home-stat-icon home-stat-icon--neutral">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <span class="home-stat-value">${resumen.num_citas}</span>
        <span class="home-stat-label">citas</span>
      </div>
      <div class="home-stat">
        <div class="home-stat-icon home-stat-icon--expense">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>
          </svg>
        </div>
        <span class="home-stat-value home-stat-value--expense">${formatMXN(resumen.gastos)}</span>
        <span class="home-stat-label">gastos</span>
      </div>
    `;

    renderComisionesSemana(comisionesEl, comisionesRes.comisiones || []);
  } catch {
    resumenCard.style.display = 'none';
  }
}

function renderComisionesSemana(el, comisiones) {
  const grupos = agruparComisionesPorTrabajadora(comisiones);
  if (grupos.length === 0) {
    el.innerHTML = '';
    return;
  }

  const totalSemana = grupos.reduce((sum, g) => sum + g.total, 0);

  el.innerHTML = `
    <div class="home-comisiones-title">Comisiones de la semana</div>
    <div class="home-comisiones-list">
      ${grupos.map((g, i) => `
        <div class="home-comision-row">
          <span class="home-comision-avatar home-comision-avatar--${AVATAR_COLORES[i % AVATAR_COLORES.length]}">
            ${escapeHTML(g.trabajadora.charAt(0).toUpperCase())}
          </span>
          <span class="home-comision-nombre">${escapeHTML(g.trabajadora)}</span>
          <span class="home-comision-monto">${formatMXN(g.total)}</span>
        </div>
      `).join('')}
      <div class="home-comision-row home-comision-row--total">
        <span class="home-comision-avatar-spacer"></span>
        <span class="home-comision-nombre">Total semana</span>
        <span class="home-comision-monto">${formatMXN(totalSemana)}</span>
      </div>
    </div>
  `;
}
