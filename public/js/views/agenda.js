/**
 * Pantalla Agenda
 *
 * Ver y administrar las citas agendadas. Dos formas de ver, con un selector
 * simple arriba (como pestañas):
 * - Agenda (default): próximas citas agrupadas por fecha, próximos 60 días.
 * - Mes: cuadrícula tipo calendario con un punto por día que tiene citas;
 *   tocas un día y ves su lista abajo (misma fila que en Agenda).
 *
 * Tocar una cita agendada abre un menú con: confirmar por WhatsApp (y
 * agregar/cambiar el teléfono de la clienta ahí mismo), registrar su cobro,
 * editar anticipo y nota (un solo editor), marcar "no asistió" (si sigue
 * pendiente), cancelar (si sigue pendiente), o eliminar (con "Deshacer",
 * igual que citas/gastos). Una cita ya completada no se elimina aquí: su
 * menú lleva directo a su cobro en Ver Registros, donde se corrige.
 *
 * "Sin cerrar" (solo dueña, vista Agenda): citas de días pasados que siguen
 * en pendiente. La lista normal empieza en hoy, así que sin esta sección
 * se perdían de vista con su anticipo sin conciliar.
 */

import {
  getCitasAgendadas, updateCitaAgendada, updateAnticipoAgendada, deleteCitaAgendada, restoreCitaAgendada, getClientas, saveNotaFija,
  createAusencia, deleteAusencia, restoreAusencia,
} from '../api.js';
import { formatMXN, todayISO, nowTimestamp, showToast, showLoader, hideLoader, escapeHTML, normalizeNombre, loadingHTML, formatRangoFecha, formatFechaLarga, formatHora12, METODOS_PAGO } from '../utils.js';
import { navigateTo } from '../app.js';
import { isTrabajadora } from '../auth.js';
import { abrirWhatsApp } from '../whatsapp.js';
import { renderHoraPicker, getHoraPickerValue } from '../hora-picker.js';

let session = null;
let vista = 'agenda'; // 'agenda' | 'mes'
let citasAgendadas = [];
let ausencias = []; // vacaciones/días libres (dueña o una trabajadora)
let mesSeleccionado = ''; // YYYY-MM (vista "Mes")
let diaSeleccionado = ''; // YYYY-MM-DD (vista "Mes")
let telefonosPorClienta = {}; // { "clave normalizada": "4421234567" }
// ¿Esta sesión puede ver/agregar teléfonos y confirmar por WhatsApp? La
// dueña siempre; una trabajadora solo si la dueña le dio el permiso en
// Configuración. Lo dice el servidor (permiso_telefonos) en cada carga.
let permisoTelefonos = false;
let sinCerrar = []; // pendientes de días pasados (solo dueña)

const DIAS_RANGO_AGENDA = 60;

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  completada: 'Completada',
  no_asistio: 'No asistió',
  cancelada: 'Cancelada',
};

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDiasISO(fechaISO, dias) {
  const d = new Date(fechaISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return toISODate(d);
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return { desde: `${yearMonth}-01`, hasta: `${yearMonth}-${String(ultimoDia).padStart(2, '0')}` };
}

/** "2026-09" → "Septiembre 2026" */
function formatMesLabel(yearMonth) {
  const d = new Date(yearMonth + '-01T12:00:00');
  const texto = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "2026-10-09" → "viernes 9 de octubre": en minúscula y sin coma, porque
 * va a media oración en el mensaje de confirmación. */
function fechaEnOracion(fechaISO) {
  return formatFechaLarga(fechaISO).replace(',', '').toLowerCase();
}

/** "a las 4:30 PM", pero "a la 1:00 PM": en español la 1 va en singular. */
function aLaHora(hora) {
  const hora12 = formatHora12(hora);
  return `${hora12.startsWith('1:') ? 'a la' : 'a las'} ${hora12}`;
}

/** Mensaje predeterminado para confirmar una cita por WhatsApp. Es el texto
 * que pidió Martha; se puede editar en WhatsApp antes de enviarlo. */
function buildMensajeConfirmacion(cita) {
  return `Hola! Te escribo de Martha Rdz Hair Artist para confirmar tu próxima cita el día ${fechaEnOracion(cita.fecha)} ${aLaHora(cita.hora)}. ¿Confirmas tu cita? Gracias!`;
}

export function render(s) {
  session = s;
  return `
    <div class="screen" id="agenda-screen">
      <header class="screen-header">
        <button class="header-back" id="agenda-back">← Atrás</button>
        <h2 class="screen-title">Agenda</h2>
        <div class="screen-header-spacer"></div>
        <button class="header-action-btn" id="btn-nueva-cita-agendada" aria-label="Agendar cita">+</button>
      </header>

      <div class="view-toggle" id="view-toggle">
        <button class="view-toggle-btn active" data-vista="agenda">Agenda</button>
        <button class="view-toggle-btn" data-vista="mes">Mes</button>
      </div>

      <div id="agenda-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando agenda...')}
        </div>
      </div>
    </div>

    <!-- Menú de acciones de una cita agendada -->
    <div class="delete-modal hidden" id="action-sheet">
      <div class="delete-modal-backdrop" id="action-sheet-backdrop"></div>
      <div class="delete-modal-content action-sheet-content" id="action-sheet-content"></div>
    </div>
  `;
}

export function init(s) {
  session = s;
  vista = 'agenda';
  mesSeleccionado = currentYearMonth();
  diaSeleccionado = '';
  citasAgendadas = [];
  ausencias = [];
  telefonosPorClienta = {};
  permisoTelefonos = !isTrabajadora();
  sinCerrar = [];

  // Teléfonos para "Confirmar por WhatsApp" — son "detalle de clienta". A
  // una trabajadora el servidor solo se los manda si tiene el permiso.
  loadTelefonos();

  document.getElementById('agenda-back').addEventListener('click', () => navigateTo('home'));
  document.getElementById('btn-nueva-cita-agendada').addEventListener('click', () => {
    // Marcar vacaciones es una decisión de la dueña (ver api/citas-agendadas.js)
    // — para una trabajadora el "+" va directo a agendar, sin el menú de más.
    if (isTrabajadora()) {
      navigateTo(`agendar?fecha=${fechaParaNuevaCita()}`);
      return;
    }
    openNuevoMenu();
  });
  document.getElementById('action-sheet-backdrop').addEventListener('click', closeActionSheet);

  document.getElementById('view-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vista]');
    if (!btn || btn.dataset.vista === vista) return;
    vista = btn.dataset.vista;
    diaSeleccionado = '';
    document.querySelectorAll('.view-toggle-btn').forEach((b) => b.classList.toggle('active', b.dataset.vista === vista));
    load();
  });

  load();
}

/** Non-blocking: si falla, el botón de WhatsApp simplemente no aparece
 * (mismo criterio que el resto de cargas silenciosas de esta pantalla). */
async function loadTelefonos() {
  if (!session?.sheet_id) return;
  try {
    const res = await getClientas(session.sheet_id);
    telefonosPorClienta = res.telefonos || {};
    permisoTelefonos = res.permiso_telefonos !== false;
  } catch {
    /* silencioso */
  }
}

async function load() {
  const content = document.getElementById('agenda-content');
  if (!session?.sheet_id) return;

  const { desde, hasta } = vista === 'mes'
    ? monthRange(mesSeleccionado)
    : { desde: todayISO(), hasta: addDiasISO(todayISO(), DIAS_RANGO_AGENDA) };

  // "Sin cerrar": pendientes hasta ayer, sin límite hacia atrás. Solo en la
  // vista Agenda y solo para la dueña (cambiar su estado es cosa de ella).
  const conSinCerrar = vista === 'agenda' && !isTrabajadora();

  try {
    showLoader();
    const [res, resSinCerrar] = await Promise.all([
      getCitasAgendadas(session.sheet_id, { desde, hasta }),
      conSinCerrar
        ? getCitasAgendadas(session.sheet_id, { hasta: addDiasISO(todayISO(), -1), estado: 'pendiente' })
        : Promise.resolve(null),
    ]);
    hideLoader();
    citasAgendadas = res.citas_agendadas || [];
    ausencias = res.ausencias || [];
    sinCerrar = resSinCerrar ? (resSinCerrar.citas_agendadas || []) : [];
    renderContent();
  } catch (error) {
    hideLoader();
    content.innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar la agenda</p>
        <button class="btn btn-outline" id="retry-agenda" style="max-width: 200px; margin: 0 auto">Reintentar</button>
      </div>
    `;
    document.getElementById('retry-agenda').addEventListener('click', load);
  }
}

function renderContent() {
  const content = document.getElementById('agenda-content');
  content.innerHTML = vista === 'mes' ? buildMesView() : buildAgendaView();
  attachRowListeners(content);
  if (vista === 'mes') attachMesListeners(content);
}

/** "2026-09-24" → "24 de septiembre" (mismo día) o "24 al 28 de septiembre"
 * (rango), usando el helper que ya existe para el resumen semanal. */
function formatRangoAusencia(a) {
  return a.desde === a.hasta ? formatFechaLarga(a.desde) : formatRangoFecha(a.desde, a.hasta);
}

function buildAusenciaCard(a) {
  const quien = a.trabajadora || 'La dueña';
  return `
    <div class="ausencia-card">
      <div class="ausencia-card-info">
        <span class="ausencia-card-quien">🏖️ ${escapeHTML(quien)}</span>
        <span class="ausencia-card-rango">${formatRangoAusencia(a)}</span>
        ${a.nota ? `<span class="ausencia-card-nota">${escapeHTML(a.nota)}</span>` : ''}
      </div>
      ${!isTrabajadora() ? `<button class="ausencia-card-eliminar" data-ausencia-id="${a.id}" aria-label="Eliminar">×</button>` : ''}
    </div>
  `;
}

function buildAusenciasBanner(lista) {
  if (lista.length === 0) return '';
  return `<div class="ausencias-banner">${lista.map(buildAusenciaCard).join('')}</div>`;
}

/** Pendientes de días pasados, de la más reciente a la más vieja. */
function buildSinCerrar() {
  if (sinCerrar.length === 0) return '';
  const lista = [...sinCerrar].sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  return `
    <div class="records-section sin-cerrar">
      <div class="records-section-title">Sin cerrar (${lista.length})</div>
      <p class="multi-select-hint">Citas de días pasados que siguen pendientes. Registra su cobro o márcalas como no asistió o canceladas.</p>
      ${lista.map((c) => buildAgendaRow(c, { conFecha: true })).join('')}
    </div>
  `;
}

// --- Vista "Agenda": lista agrupada por fecha ---
function buildAgendaView() {
  // Las vacaciones/días libres van primero, antes que cualquier cita — es
  // lo primero que la dueña quiere ver al abrir la Agenda. Luego lo que
  // quedó sin cerrar de días pasados.
  const banner = buildAusenciasBanner(ausencias) + buildSinCerrar();

  if (citasAgendadas.length === 0) {
    return banner + `
      <div class="empty-state">
        <div class="empty-state-emoji">📅</div>
        <p class="empty-state-text">No hay citas agendadas próximamente</p>
        <button class="btn btn-outline mt-16" id="btn-agendar-vacio" style="max-width:240px;margin:0 auto">Agendar cita</button>
      </div>
    `;
  }

  const porFecha = {};
  for (const c of citasAgendadas) {
    if (!porFecha[c.fecha]) porFecha[c.fecha] = [];
    porFecha[c.fecha].push(c);
  }
  const fechas = Object.keys(porFecha).sort();

  return banner + fechas.map((fecha) => `
    <div class="records-section">
      <div class="records-section-title">${formatFechaLarga(fecha)}</div>
      ${porFecha[fecha].map((c) => buildAgendaRow(c)).join('')}
    </div>
  `).join('');
}

/** "2026-09-22" → "Mar 22 de sep" (para las filas de "Sin cerrar"). */
function formatFechaCorta(fechaISO) {
  const d = new Date(fechaISO + 'T12:00:00');
  const texto = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function buildAgendaRow(c, { conFecha = false } = {}) {
  return `
    <button class="agenda-row" data-agenda-id="${c.id}">
      <div class="agenda-row-hora">${formatHora12(c.hora)}</div>
      <div class="agenda-row-info">
        <span class="agenda-row-clienta">${escapeHTML(c.clienta)}</span>
        ${conFecha ? `<span class="agenda-row-fecha">${formatFechaCorta(c.fecha)}</span>` : ''}
        ${c.anticipo > 0 ? `<span class="agenda-row-anticipo">Anticipo ${formatMXN(c.anticipo)}</span>` : ''}
      </div>
      <span class="agenda-estado-badge agenda-estado-badge--${c.estado}">${ESTADO_LABEL[c.estado]}</span>
    </button>
  `;
}

// --- Vista "Mes": cuadrícula + lista del día seleccionado ---
function buildMesView() {
  const conteoPorDia = {};
  for (const c of citasAgendadas) {
    conteoPorDia[c.fecha] = (conteoPorDia[c.fecha] || 0) + 1;
  }

  const [year, month] = mesSeleccionado.split('-').map(Number);
  const primerDiaSemana = new Date(year, month - 1, 1).getDay(); // 0=domingo
  const offset = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1; // lunes=0
  const totalDias = new Date(year, month, 0).getDate();
  const hoy = todayISO();

  let celdas = '';
  for (let i = 0; i < offset; i++) {
    celdas += '<div class="month-day-cell month-day-cell--vacia"></div>';
  }
  for (let dia = 1; dia <= totalDias; dia++) {
    const fechaISO = `${mesSeleccionado}-${String(dia).padStart(2, '0')}`;
    const tieneCitas = conteoPorDia[fechaISO] > 0;
    const tieneAusencia = ausencias.some((a) => a.desde <= fechaISO && fechaISO <= a.hasta);
    const clases = ['month-day-cell'];
    if (tieneAusencia) clases.push('month-day-cell--ausencia');
    if (fechaISO === hoy) clases.push('month-day-cell--hoy');
    if (fechaISO === diaSeleccionado) clases.push('month-day-cell--selected');
    celdas += `
      <button class="${clases.join(' ')}" data-fecha="${fechaISO}">
        <span class="month-day-number">${dia}</span>
        ${tieneCitas ? '<span class="month-day-dot"></span>' : ''}
      </button>
    `;
  }

  const citasDelDia = diaSeleccionado ? citasAgendadas.filter((c) => c.fecha === diaSeleccionado) : [];
  const ausenciasDelDia = diaSeleccionado ? ausencias.filter((a) => a.desde <= diaSeleccionado && diaSeleccionado <= a.hasta) : [];

  // En celular el detalle solo ocupa espacio si hay un día elegido (igual
  // que siempre). En iPad, con la cuadrícula y el detalle lado a lado, se
  // deja el hueco con un hint en vez de verse vacío sin razón.
  const detalle = diaSeleccionado
    ? `
      ${buildAusenciasBanner(ausenciasDelDia)}
      <div class="records-section-title">${formatFechaLarga(diaSeleccionado)}</div>
      ${citasDelDia.length > 0
        ? citasDelDia.map((c) => buildAgendaRow(c)).join('')
        : '<p class="empty-state-text" style="padding: 16px 0">Sin citas este día</p>'}
    `
    : '<p class="empty-state-text mes-dia-hint" style="padding: 16px 0">Toca un día en el calendario para ver sus citas</p>';

  return `
    <div class="mes-grid">
      <div class="mes-grid-col">
        <div class="month-nav">
          <button class="month-nav-btn" id="mes-prev" aria-label="Mes anterior">←</button>
          <span class="month-nav-label">${formatMesLabel(mesSeleccionado)}</span>
          <button class="month-nav-btn" id="mes-next" aria-label="Mes siguiente">→</button>
        </div>
        <div class="month-grid-labels">
          ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}
        </div>
        <div class="month-grid">${celdas}</div>
      </div>

      <div class="mes-grid-col">
        <div class="records-section mes-detalle-section">${detalle}</div>
      </div>
    </div>
  `;
}

function attachMesListeners(content) {
  document.getElementById('mes-prev').addEventListener('click', () => cambiarMes(-1));
  document.getElementById('mes-next').addEventListener('click', () => cambiarMes(1));

  content.querySelectorAll('[data-fecha]').forEach((cell) => {
    cell.addEventListener('click', () => {
      diaSeleccionado = diaSeleccionado === cell.dataset.fecha ? '' : cell.dataset.fecha;
      renderContent();
    });
  });
}

function cambiarMes(delta) {
  const [year, month] = mesSeleccionado.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  mesSeleccionado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  diaSeleccionado = '';
  load();
}

function attachRowListeners(content) {
  const btnVacio = document.getElementById('btn-agendar-vacio');
  if (btnVacio) btnVacio.addEventListener('click', () => navigateTo('agendar'));

  content.querySelectorAll('.agenda-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.agendaId;
      const cita = citasAgendadas.find((c) => c.id === id) || sinCerrar.find((c) => c.id === id);
      if (cita) openActionSheet(cita);
    });
  });

  content.querySelectorAll('.ausencia-card-eliminar').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmarEliminarAusencia(btn.dataset.ausenciaId);
    });
  });
}

/** El día con el que debe abrir "Agendar Cita": el que esté elegido en la
 * cuadrícula de la vista Mes (si hay uno), o hoy — así el "+" agenda en el
 * día que la usuaria ya está viendo, en vez de siempre asumir hoy. */
function fechaParaNuevaCita() {
  return (vista === 'mes' && diaSeleccionado) ? diaSeleccionado : todayISO();
}

// --- "+": elegir entre agendar una cita o marcar vacaciones/día libre ---
function openNuevoMenu() {
  const sheet = document.getElementById('action-sheet');
  const content = document.getElementById('action-sheet-content');

  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">¿Qué quieres agregar?</span>
    </div>
    <button class="action-sheet-btn" id="accion-nueva-cita">📅 Agendar cita</button>
    <button class="action-sheet-btn" id="accion-nueva-ausencia">🏖️ Vacaciones / día libre</button>
    <button class="btn btn-outline mt-16" id="accion-cerrar">Cancelar</button>
  `;
  sheet.classList.remove('hidden');

  document.getElementById('accion-cerrar').addEventListener('click', closeActionSheet);
  document.getElementById('accion-nueva-cita').addEventListener('click', () => {
    closeActionSheet();
    navigateTo(`agendar?fecha=${fechaParaNuevaCita()}`);
  });
  document.getElementById('accion-nueva-ausencia').addEventListener('click', openAusenciaForm);
}

/** Acceso directo para marcar vacaciones/días libres: elegir quién, un
 * rango de fechas y guardar — sin pasar por el flujo completo de Agendar
 * Cita, que no aplica aquí (no hay clienta ni anticipo). */
function openAusenciaForm() {
  const content = document.getElementById('action-sheet-content');
  const trabajadoras = session?.trabajadoras || [];
  const opciones = ['<option value="">Yo (la dueña)</option>']
    .concat(trabajadoras.map((t) => `<option value="${escapeHTML(t.nombre)}">${escapeHTML(t.nombre)}</option>`))
    .join('');

  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">Vacaciones / día libre</span>
    </div>
    <label class="input-label">¿Quién?</label>
    <select class="input" id="ausencia-quien">${opciones}</select>
    <label class="input-label mt-16">Desde</label>
    <input type="date" class="date-picker-input" id="ausencia-desde" value="${todayISO()}">
    <label class="input-label mt-16">Hasta</label>
    <input type="date" class="date-picker-input" id="ausencia-hasta" value="${todayISO()}">
    <label class="input-label mt-16">Nota (opcional)</label>
    <input type="text" class="input" id="ausencia-nota" maxlength="200" placeholder="Ej: Vacaciones de fin de año">
    <div class="step-actions mt-16">
      <button class="btn btn-outline" id="ausencia-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="ausencia-guardar">Guardar</button>
    </div>
  `;

  const desdeInput = document.getElementById('ausencia-desde');
  const hastaInput = document.getElementById('ausencia-hasta');
  hastaInput.min = desdeInput.value;
  desdeInput.addEventListener('change', () => {
    hastaInput.min = desdeInput.value;
    if (hastaInput.value < desdeInput.value) hastaInput.value = desdeInput.value;
  });

  document.getElementById('ausencia-cancelar').addEventListener('click', closeActionSheet);
  document.getElementById('ausencia-guardar').addEventListener('click', guardarAusencia);
}

async function guardarAusencia() {
  const trabajadora = document.getElementById('ausencia-quien').value;
  const desde = document.getElementById('ausencia-desde').value;
  const hasta = document.getElementById('ausencia-hasta').value;
  const nota = document.getElementById('ausencia-nota').value.trim();

  if (!desde || !hasta) {
    showToast('Selecciona las fechas', 'error');
    return;
  }
  if (hasta < desde) {
    showToast('"Hasta" no puede ser antes de "Desde"', 'error');
    return;
  }

  try {
    showLoader();
    await createAusencia(session.sheet_id, { trabajadora, desde, hasta, nota });
    hideLoader();
    closeActionSheet();
    showToast('Días libres guardados', 'success');
    load();
  } catch (error) {
    hideLoader();
    showToast(error.message || 'No se pudieron guardar los días libres', 'error');
  }
}

/** Mismo paso "¿Seguro?" que el resto de la Agenda: un toque por error en
 * la × no debe bastar para borrar unas vacaciones. */
function confirmarEliminarAusencia(id) {
  const a = ausencias.find((x) => x.id === id);
  if (!a) return;
  const sheet = document.getElementById('action-sheet');
  const content = document.getElementById('action-sheet-content');
  content.innerHTML = `
    <div class="action-sheet-confirm">
      <h3 class="delete-modal-title">¿Eliminar estos días libres?</h3>
      <p class="delete-modal-text">
        <strong>${escapeHTML(a.trabajadora || 'La dueña')}</strong><br>
        ${formatRangoAusencia(a)}
        ${a.nota ? `<br>${escapeHTML(a.nota)}` : ''}
      </p>
    </div>
    <div class="delete-modal-actions">
      <button class="btn btn-outline delete-modal-btn" id="confirmar-no">No, volver</button>
      <button class="btn delete-modal-btn delete-modal-btn--confirm" id="confirmar-si">Sí, eliminar</button>
    </div>
  `;
  sheet.classList.remove('hidden');
  document.getElementById('confirmar-no').addEventListener('click', closeActionSheet);
  document.getElementById('confirmar-si').addEventListener('click', () => {
    closeActionSheet();
    eliminarAusencia(id);
  });
}

async function eliminarAusencia(id) {
  try {
    showLoader();
    await deleteAusencia(session.sheet_id, id);
    hideLoader();
    showToast('Ausencia eliminada', 'success', 5000, {
      label: 'Deshacer',
      onClick: () => undoEliminarAusencia(id),
    });
    load();
  } catch (error) {
    hideLoader();
    showToast('Error al eliminar', 'error');
  }
}

async function undoEliminarAusencia(id) {
  try {
    showLoader();
    await restoreAusencia(session.sheet_id, id);
    hideLoader();
    showToast('Ausencia restaurada', 'success');
    load();
  } catch (error) {
    hideLoader();
    showToast('No se pudo deshacer', 'error');
  }
}

// --- Menú de acciones de una cita agendada ---
function openActionSheet(cita) {
  const sheet = document.getElementById('action-sheet');
  const content = document.getElementById('action-sheet-content');

  // Una trabajadora solo puede ver la información — reagendar/editar nota/
  // no asistió/cancelar/eliminar son de la dueña (ya bloqueadas en el
  // backend; aquí es para no mostrarle botones que le van a fallar). Si la
  // dueña le dio el permiso de teléfonos, también puede agregar el teléfono
  // y confirmar por WhatsApp una cita pendiente.
  if (isTrabajadora()) {
    const telefonoT = permisoTelefonos ? telefonosPorClienta[normalizeNombre(cita.clienta)] || '' : '';
    const conTelefonos = permisoTelefonos && cita.estado === 'pendiente';
    content.innerHTML = `
      <div class="action-sheet-header">
        <span class="action-sheet-clienta">${escapeHTML(cita.clienta)}</span>
        <span class="action-sheet-meta">${formatFechaLarga(cita.fecha)} · ${formatHora12(cita.hora)}</span>
      </div>
      ${cita.anticipo > 0 ? `<p class="agenda-row-anticipo" style="margin: 0 0 8px">Anticipo ${formatMXN(cita.anticipo)}</p>` : ''}
      ${cita.nota ? `<p class="empty-state-text" style="padding: 0 0 8px; text-align: left">${escapeHTML(cita.nota)}</p>` : ''}
      ${conTelefonos && telefonoT ? '<button class="action-sheet-btn action-sheet-btn--whatsapp" id="accion-confirmar-whatsapp">Confirmar por WhatsApp</button>' : ''}
      ${conTelefonos ? `<button class="action-sheet-btn" id="accion-telefono">${telefonoT ? `📱 Cambiar teléfono · ${escapeHTML(formatTelefono(telefonoT))}` : '📱 Agregar teléfono para WhatsApp'}</button>` : ''}
      <button class="btn btn-outline mt-16" id="accion-cerrar">Cerrar</button>
    `;
    sheet.classList.remove('hidden');
    document.getElementById('accion-cerrar').addEventListener('click', closeActionSheet);
    document.getElementById('accion-confirmar-whatsapp')?.addEventListener('click', () => {
      abrirWhatsApp(telefonoT, buildMensajeConfirmacion(cita));
      closeActionSheet();
    });
    document.getElementById('accion-telefono')?.addEventListener('click', () => abrirEditorTelefono(cita, telefonoT));
    return;
  }

  const esPendiente = cita.estado === 'pendiente';
  const esCompletada = cita.estado === 'completada';
  // Cancelada / no asistió se pueden revertir (por si se marcó por error o
  // la clienta sí va a venir). Completada no: ya tiene su cobro registrado.
  const esRevertible = cita.estado === 'cancelada' || cita.estado === 'no_asistio';
  const telefono = telefonosPorClienta[normalizeNombre(cita.clienta)] || '';
  // Cobrar: hoy o un día pasado (una futura todavía no llega).
  const puedeCobrarse = esPendiente && cita.fecha <= todayISO();

  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">${escapeHTML(cita.clienta)}</span>
      <span class="action-sheet-meta">${formatFechaLarga(cita.fecha)} · ${formatHora12(cita.hora)}</span>
      ${cita.anticipo > 0 ? `<span class="agenda-row-anticipo">Anticipo ${formatMXN(cita.anticipo)}${cita.anticipo_metodo_pago ? ` · ${escapeHTML(cita.anticipo_metodo_pago)}` : ''}</span>` : ''}
    </div>
    ${esCompletada ? `
      <p class="multi-select-hint action-sheet-nota">Ya se cobró. Si algo quedó mal, ahí puedes corregir el monto o eliminar el cobro.</p>
      <button class="action-sheet-btn action-sheet-btn--cobrar" id="accion-ver-cobro">💵 Ver cobro en Registros</button>
    ` : ''}
    ${puedeCobrarse ? '<button class="action-sheet-btn action-sheet-btn--cobrar" id="accion-cobrar">💵 Registrar cobro</button>' : ''}
    ${esPendiente && telefono ? '<button class="action-sheet-btn action-sheet-btn--whatsapp" id="accion-confirmar-whatsapp">Confirmar por WhatsApp</button>' : ''}
    ${esPendiente ? `<button class="action-sheet-btn" id="accion-telefono">${telefono ? `📱 Cambiar teléfono · ${escapeHTML(formatTelefono(telefono))}` : '📱 Agregar teléfono para WhatsApp'}</button>` : ''}
    ${!esCompletada ? '<button class="action-sheet-btn" id="accion-editar-nota">✎ Editar anticipo y nota</button>' : ''}
    ${esPendiente ? `
      <button class="action-sheet-btn" id="accion-reagendar">📅 Reagendar</button>
      <button class="action-sheet-btn" id="accion-no-asistio">No asistió</button>
      <button class="action-sheet-btn" id="accion-cancelar">Cancelar cita</button>
    ` : ''}
    ${esRevertible ? '<button class="action-sheet-btn" id="accion-pendiente">↺ Volver a pendiente</button>' : ''}
    ${!esCompletada ? '<button class="action-sheet-btn action-sheet-btn--danger" id="accion-eliminar">Eliminar</button>' : ''}
    <button class="btn btn-outline mt-16" id="accion-cerrar">Cerrar</button>
  `;

  sheet.classList.remove('hidden');

  document.getElementById('accion-cerrar').addEventListener('click', closeActionSheet);
  const btnEliminar = document.getElementById('accion-eliminar');
  if (btnEliminar) btnEliminar.addEventListener('click', () => confirmarEliminar(cita));

  // Abre Registrar Cita en el día de esta cita: ahí aparece su recuadro
  // (con el anticipo ya descontado) para cobrarla como cualquier otra.
  const btnCobrar = document.getElementById('accion-cobrar');
  if (btnCobrar) {
    btnCobrar.addEventListener('click', () => {
      closeActionSheet();
      navigateTo(`cita?fecha=${cita.fecha}`);
    });
  }

  // Una completada ya no se toca aquí: se lleva directo a su cobro, en el
  // día de la cita (el cobro siempre queda en ese día, ver cita.js), para
  // no tener que buscarlo a mano en Ver Registros.
  const btnVerCobro = document.getElementById('accion-ver-cobro');
  if (btnVerCobro) {
    btnVerCobro.addEventListener('click', () => {
      closeActionSheet();
      navigateTo(`registros?fecha=${cita.fecha}&agenda=${cita.id}`);
    });
  }

  const btnConfirmarWhatsApp = document.getElementById('accion-confirmar-whatsapp');
  if (btnConfirmarWhatsApp) {
    btnConfirmarWhatsApp.addEventListener('click', () => {
      abrirWhatsApp(telefono, buildMensajeConfirmacion(cita));
      closeActionSheet();
    });
  }

  const btnTelefono = document.getElementById('accion-telefono');
  if (btnTelefono) btnTelefono.addEventListener('click', () => abrirEditorTelefono(cita, telefono));

  const btnEditarNota = document.getElementById('accion-editar-nota');
  if (btnEditarNota) btnEditarNota.addEventListener('click', () => abrirEditorNotaAgenda(cita));

  const btnReagendar = document.getElementById('accion-reagendar');
  if (btnReagendar) btnReagendar.addEventListener('click', () => abrirEditorReagendar(cita));

  const btnNoAsistio = document.getElementById('accion-no-asistio');
  if (btnNoAsistio) btnNoAsistio.addEventListener('click', () => confirmarCambioEstado(cita, 'no_asistio'));

  const btnCancelar = document.getElementById('accion-cancelar');
  if (btnCancelar) btnCancelar.addEventListener('click', () => confirmarCambioEstado(cita, 'cancelada'));

  const btnPendiente = document.getElementById('accion-pendiente');
  if (btnPendiente) btnPendiente.addEventListener('click', () => cambiarEstado(cita, 'pendiente'));
}

/** Paso "¿Seguro?" dentro del mismo menú, antes de cualquier acción que
 * saque la cita de la agenda activa — un toque por error no debe bastar.
 * "No, volver" regresa al menú de la cita. */
function pedirConfirmacion(cita, { titulo, detalle, boton, onConfirm }) {
  const content = document.getElementById('action-sheet-content');
  content.innerHTML = `
    <div class="action-sheet-confirm">
      <h3 class="delete-modal-title">${titulo}</h3>
      <p class="delete-modal-text">
        <strong>${escapeHTML(cita.clienta)}</strong><br>
        ${formatFechaLarga(cita.fecha)} · ${formatHora12(cita.hora)}
        ${detalle ? `<br><br>${detalle}` : ''}
      </p>
    </div>
    <div class="delete-modal-actions">
      <button class="btn btn-outline delete-modal-btn" id="confirmar-no">No, volver</button>
      <button class="btn delete-modal-btn delete-modal-btn--confirm" id="confirmar-si">${boton}</button>
    </div>
  `;
  document.getElementById('confirmar-no').addEventListener('click', () => openActionSheet(cita));
  document.getElementById('confirmar-si').addEventListener('click', onConfirm);
}

function confirmarCambioEstado(cita, estado) {
  const anticipo = cita.anticipo > 0 ? `El anticipo de ${formatMXN(cita.anticipo)} se conserva. ` : '';
  pedirConfirmacion(cita, estado === 'cancelada'
    ? {
      titulo: '¿Cancelar esta cita?',
      detalle: `${anticipo}Si fue un error, puedes volver a ponerla como pendiente.`,
      boton: 'Sí, cancelar',
      onConfirm: () => cambiarEstado(cita, 'cancelada'),
    }
    : {
      titulo: '¿Marcar que no asistió?',
      detalle: `${anticipo}Si fue un error, puedes volver a ponerla como pendiente.`,
      boton: 'Sí, marcar',
      onConfirm: () => cambiarEstado(cita, 'no_asistio'),
    });
}

function confirmarEliminar(cita) {
  pedirConfirmacion(cita, {
    titulo: '¿Eliminar esta cita?',
    // Eliminar también borra el ingreso del anticipo (ver api/citas-agendadas.js)
    detalle: cita.anticipo > 0
      ? `Se borra de la agenda junto con su anticipo de ${formatMXN(cita.anticipo)} en los ingresos.`
      : 'Se borra de la agenda.',
    boton: 'Sí, eliminar',
    onConfirm: () => eliminarCitaAgendada(cita),
  });
}

function closeActionSheet() {
  document.getElementById('action-sheet').classList.add('hidden');
}

/** Editor de anticipo y nota en uno solo — corregir el anticipo es raro y
 * no merecía otro botón en el menú. Si el monto o el método cambian, su
 * ingreso en Ver Registros se corrige solo (ver PATCH en
 * api/citas-agendadas.js); si no, solo se guarda la nota, como siempre. */
function abrirEditorNotaAgenda(cita) {
  const content = document.getElementById('action-sheet-content');
  const anticipoActual = Number(cita.anticipo) || 0;
  let metodo = anticipoActual > 0 && METODOS_PAGO.some((m) => m.id === cita.anticipo_metodo_pago) ? cita.anticipo_metodo_pago : '';

  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">${escapeHTML(cita.clienta)}</span>
      <span class="action-sheet-meta">${formatFechaLarga(cita.fecha)} · ${formatHora12(cita.hora)}</span>
    </div>
    <label class="input-label" for="editor-anticipo-monto">Anticipo</label>
    <div class="money-input">
      <input type="text" class="input" id="editor-anticipo-monto" inputmode="decimal"
        autocomplete="off" maxlength="10" placeholder="0" value="${anticipoActual > 0 ? anticipoActual : ''}">
    </div>
    <select class="input ${anticipoActual > 0 ? '' : 'hidden'}" id="editor-anticipo-metodo" aria-label="Cómo pagó el anticipo">
      <option value="" ${metodo ? '' : 'selected'} disabled>¿Cómo pagó el anticipo?</option>
      ${METODOS_PAGO.map((m) => `<option value="${m.id}" ${metodo === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
    </select>
    <p class="multi-select-hint anticipo-editor-hint">Si cambias el anticipo, su ingreso en Registros se corrige solo. Sin anticipo, deja $0.</p>
    <label class="input-label mt-8" for="editor-nota-agenda">Nota</label>
    <textarea class="input textarea" id="editor-nota-agenda" rows="3" maxlength="2000"
      placeholder="Notas de la cita">${escapeHTML(cita.nota)}</textarea>
    <div class="step-actions mt-16">
      <button class="btn btn-outline" id="editor-nota-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="editor-nota-guardar">Guardar</button>
    </div>
  `;

  const montoInput = document.getElementById('editor-anticipo-monto');
  const metodoSelect = document.getElementById('editor-anticipo-metodo');
  const leerMonto = () => {
    const texto = montoInput.value.trim();
    return texto === '' ? 0 : Number(texto);
  };

  montoInput.addEventListener('input', () => {
    // Solo dígitos y un punto con hasta 2 decimales
    const limpio = montoInput.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2})\d+$/, '$1');
    if (limpio !== montoInput.value) montoInput.value = limpio;
    metodoSelect.classList.toggle('hidden', !(leerMonto() > 0));
  });

  metodoSelect.addEventListener('change', () => {
    metodo = metodoSelect.value;
  });

  document.getElementById('editor-nota-cancelar').addEventListener('click', () => openActionSheet(cita));
  document.getElementById('editor-nota-guardar').addEventListener('click', async () => {
    const nota = document.getElementById('editor-nota-agenda').value.trim();
    const anticipo = Math.round(leerMonto() * 100) / 100;
    if (!Number.isFinite(anticipo) || anticipo < 0 || anticipo > 10_000_000) {
      showToast('Revisa el monto del anticipo', 'error');
      montoInput.focus();
      return;
    }
    if (anticipo > 0 && !metodo) {
      showToast('Elige cómo pagó el anticipo', 'error');
      return;
    }

    const metodoFinal = anticipo > 0 ? metodo : '';
    const cambioAnticipo = anticipo !== anticipoActual
      || (anticipo > 0 && metodoFinal !== (cita.anticipo_metodo_pago || ''));

    try {
      showLoader();
      if (cambioAnticipo) {
        await updateAnticipoAgendada(session.sheet_id, {
          id: cita.id,
          anticipo,
          anticipo_metodo_pago: metodoFinal || undefined,
          timestamp: nowTimestamp(),
          nota,
        });
      } else {
        await updateCitaAgendada(session.sheet_id, { id: cita.id, nota });
      }
      hideLoader();
      closeActionSheet();
      showToast(cambioAnticipo
        ? (anticipo > 0 ? `Anticipo actualizado: ${formatMXN(anticipo)}` : 'Anticipo quitado')
        : 'Nota guardada', 'success');
      load();
    } catch (error) {
      hideLoader();
      showToast(error.message || 'No se pudo guardar', 'error');
    }
  });
}

/** "4421234567" → "442 123 4567" (solo para mostrar, se guarda sin espacios) */
function formatTelefono(tel) {
  if (!tel || tel.length !== 10) return tel || '';
  return `${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6)}`;
}

/** Agregar/cambiar el teléfono de la clienta sin salir de la Agenda — al
 * guardar vuelve al menú de la cita, ya con "Confirmar por WhatsApp". No se
 * abre WhatsApp en automático: después de esperar al servidor el navegador
 * (Safari sobre todo) bloquea abrir otra pestaña sin un toque directo. */
function abrirEditorTelefono(cita, telefonoActual) {
  const content = document.getElementById('action-sheet-content');
  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">${escapeHTML(cita.clienta)}</span>
      <span class="action-sheet-meta">Teléfono para WhatsApp</span>
    </div>
    <p class="multi-select-hint">10 dígitos — se guarda en su registro de Clientas</p>
    <input type="tel" class="input" id="editor-telefono-agenda" inputmode="numeric"
      autocomplete="tel-national" maxlength="10" placeholder="4421234567" value="${escapeHTML(telefonoActual)}">
    <div class="step-actions mt-16">
      <button class="btn btn-outline" id="editor-telefono-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="editor-telefono-guardar">Guardar</button>
    </div>
  `;

  const input = document.getElementById('editor-telefono-agenda');
  input.focus();
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 10);
  });

  document.getElementById('editor-telefono-cancelar').addEventListener('click', () => openActionSheet(cita));
  document.getElementById('editor-telefono-guardar').addEventListener('click', async () => {
    const telefono = input.value.trim();
    if (telefono.length !== 10) {
      showToast('El teléfono debe tener 10 dígitos', 'error');
      return;
    }
    if (telefono === telefonoActual) {
      openActionSheet(cita);
      return;
    }
    const key = normalizeNombre(cita.clienta);
    try {
      showLoader();
      // El POST de clientas guarda nota fija y teléfono juntos: se lee la
      // nota fija vigente justo antes para no borrarla al guardar el
      // teléfono (la de memoria podría no haber cargado todavía). Para una
      // trabajadora la nota llega vacía, pero el servidor solo le guarda el
      // teléfono y nunca toca la nota.
      const res = await getClientas(session.sheet_id);
      const notaFija = (res.notas_fijas || {})[key] || '';
      await saveNotaFija(session.sheet_id, cita.clienta, notaFija, telefono);
      hideLoader();
      telefonosPorClienta = { ...(res.telefonos || telefonosPorClienta), [key]: telefono };
      showToast('Teléfono guardado', 'success');
      openActionSheet(cita);
    } catch (error) {
      hideLoader();
      showToast('No se pudo guardar el teléfono', 'error');
    }
  });
}

/** Reagendar: mover la fecha/hora de una cita pendiente sin tener que
 * cancelarla y crear otra (y perder así el anticipo ya ligado a ella). */
function abrirEditorReagendar(cita) {
  const content = document.getElementById('action-sheet-content');
  content.innerHTML = `
    <div class="action-sheet-header">
      <span class="action-sheet-clienta">${escapeHTML(cita.clienta)}</span>
      <span class="action-sheet-meta">Nueva fecha y hora</span>
    </div>
    <label class="input-label">Fecha</label>
    <input type="date" class="date-picker-input" id="editor-reagendar-fecha" min="${todayISO()}" value="${cita.fecha}">
    <label class="input-label mt-16">Hora</label>
    ${renderHoraPicker('editor-reagendar-hora', cita.hora)}
    <div class="step-actions mt-16">
      <button class="btn btn-outline" id="editor-reagendar-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="editor-reagendar-guardar">Guardar</button>
    </div>
  `;

  document.getElementById('editor-reagendar-cancelar').addEventListener('click', closeActionSheet);
  document.getElementById('editor-reagendar-guardar').addEventListener('click', async () => {
    const fecha = document.getElementById('editor-reagendar-fecha').value;
    const hora = getHoraPickerValue('editor-reagendar-hora');
    if (!fecha || !hora) {
      showToast('Selecciona fecha y hora', 'error');
      return;
    }
    try {
      showLoader();
      await updateCitaAgendada(session.sheet_id, { id: cita.id, fecha, hora });
      hideLoader();
      closeActionSheet();
      showToast('Cita reagendada', 'success');
      load();
    } catch (error) {
      hideLoader();
      showToast('No se pudo reagendar la cita', 'error');
    }
  });
}

const TOAST_ESTADO = {
  pendiente: 'La cita volvió a pendiente',
  no_asistio: 'Marcada como no asistió',
  cancelada: 'Cita cancelada',
};

async function cambiarEstado(cita, estado) {
  closeActionSheet();
  const estadoAnterior = cita.estado;
  try {
    showLoader();
    await updateCitaAgendada(session.sheet_id, { id: cita.id, estado });
    hideLoader();
    // Al cancelar / marcar no asistió, "Deshacer" la regresa como estaba
    showToast(TOAST_ESTADO[estado], 'success', estado === 'pendiente' ? 3000 : 5000,
      estado === 'pendiente' ? null : {
        label: 'Deshacer',
        onClick: () => cambiarEstado({ ...cita, estado }, estadoAnterior),
      });
    load();
  } catch (error) {
    hideLoader();
    showToast('No se pudo actualizar la cita', 'error');
  }
}

async function eliminarCitaAgendada(cita) {
  closeActionSheet();
  try {
    showLoader();
    await deleteCitaAgendada(session.sheet_id, cita.id);
    hideLoader();
    showToast('Cita eliminada', 'success', 5000, {
      label: 'Deshacer',
      onClick: () => undoEliminar(cita),
    });
    load();
  } catch (error) {
    hideLoader();
    showToast('Error al eliminar', 'error');
  }
}

async function undoEliminar(cita) {
  try {
    showLoader();
    await restoreCitaAgendada(session.sheet_id, cita.id);
    hideLoader();
    showToast('Cita restaurada', 'success');
    load();
  } catch (error) {
    hideLoader();
    showToast('No se pudo deshacer', 'error');
  }
}
