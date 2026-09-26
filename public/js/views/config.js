/**
 * Pantalla Configuración
 * Editar catálogo de servicios, productos y trabajadoras del salón.
 *
 * Sin botón "Guardar": cada alta o baja se guarda al momento (ver
 * guardarCatalogo). La pantalla se actualiza primero y el guardado corre
 * detrás; si falla, se vuelve a cargar lo que de verdad quedó en el servidor.
 */

import { getConfig, updateConfig, setTrabajadorPin, getWebauthnRegisterOptions, verifyWebauthnRegister, getWebauthnDevices, deleteWebauthnDevice } from '../api.js';
import { showToast, showLoader, hideLoader, escapeHTML, loadingHTML } from '../utils.js';
import { getSession, saveSession } from '../auth.js';
import { navigateTo } from '../app.js';
import { isPushSupported, getPushStatus, activarNotificaciones, desactivarNotificaciones } from '../push-client.js';
import { biometriaDisponible, biometriaActivaEnEsteDispositivo, activarBiometria, credentialIdDeEsteDispositivo, olvidarBiometriaEnEsteDispositivo } from '../webauthn-client.js';
import { versionAppHTML, pintarVersionApp, actualizarApp } from '../app-version.js';

let session = null;
let servicios = [];
let productos = [];
let trabajadoras = []; // [{nombre, tiene_acceso}]  (el % se pone al registrar cada cita)
let pinEditorIndex = -1; // índice de la trabajadora con el editor de PIN abierto, o -1
let notifStatus = 'loading'; // 'loading' | 'subscribed' | 'unsubscribed' | 'unsupported'
let configLoaded = false; // evita que loadNotifStatus() re-renderice sobre el loader inicial
let biometriaSupported = false; // este dispositivo tiene Face ID/Touch ID/Windows Hello
let biometriaActivaAqui = false; // este dispositivo ya lo activó (bandera local)
let biometriaDispositivos = []; // todos los dispositivos activados (de esta identidad)
let biometriaLoaded = false;
// Servicios y productos empiezan contraídos (listas largas); se recuerda
// mientras se está en la pantalla aunque se re-renderice.
const seccionesAbiertas = { servicios: false, productos: false };

export function render(s) {
  session = s;
  return `
    <div class="screen" id="config-screen">
      <header class="screen-header">
        <button class="header-back" id="config-back">← Atrás</button>
        <h2 class="screen-title">Configuración</h2>
      </header>

      <div id="config-content">
        <div class="text-center" style="padding: 40px 0">
          ${loadingHTML('Cargando...')}
        </div>
      </div>
    </div>

    <!-- Confirmación antes de quitar un servicio, producto o trabajadora -->
    <div class="delete-modal hidden" id="config-delete-modal">
      <div class="delete-modal-backdrop" id="config-delete-backdrop"></div>
      <div class="delete-modal-content">
        <h3 class="delete-modal-title" id="config-delete-title"></h3>
        <p class="delete-modal-text" id="config-delete-text"></p>
        <div class="delete-modal-actions">
          <button class="btn btn-outline delete-modal-btn" id="config-delete-cancel">No, volver</button>
          <button class="btn delete-modal-btn delete-modal-btn--confirm" id="config-delete-confirm">Sí, eliminar</button>
        </div>
      </div>
    </div>
  `;
}

export function init(s) {
  session = s;
  pinEditorIndex = -1;
  notifStatus = 'loading';
  configLoaded = false;
  biometriaLoaded = false;
  seccionesAbiertas.servicios = false;
  seccionesAbiertas.productos = false;

  document.getElementById('config-back').addEventListener('click', () => navigateTo('home'));
  // Delegado UNA sola vez sobre el contenedor (que no se reemplaza entre
  // renders, solo su innerHTML) — si se registrara dentro de renderConfig()
  // (que se llama muchas veces: agregar servicio/producto/trabajadora, abrir
  // el editor de PIN, etc.) se irían acumulando listeners duplicados y un
  // solo clic dispararía el manejador varias veces, pisándose entre sí
  // (ej. abrir y cerrar el editor de PIN en el mismo clic).
  document.getElementById('config-content').addEventListener('click', handleContentClick);
  document.getElementById('config-delete-backdrop').addEventListener('click', cerrarConfirmarEliminar);
  document.getElementById('config-delete-cancel').addEventListener('click', cerrarConfirmarEliminar);
  document.getElementById('config-delete-confirm').addEventListener('click', () => {
    const accion = eliminarPendiente;
    cerrarConfirmarEliminar();
    if (accion) accion();
  });
  load();
  loadNotifStatus();
  loadBiometriaStatus();
}

/** Non-blocking: si tarda, la sección de notificaciones simplemente
 * aparece un instante después que el resto de Configuración. */
async function loadNotifStatus() {
  notifStatus = isPushSupported() ? await getPushStatus() : 'unsupported';
  if (configLoaded) renderConfig();
}

/** Non-blocking, igual que loadNotifStatus. */
async function loadBiometriaStatus() {
  biometriaSupported = await biometriaDisponible();
  biometriaActivaAqui = biometriaActivaEnEsteDispositivo();
  try {
    const res = await getWebauthnDevices();
    biometriaDispositivos = res.dispositivos || [];
  } catch {
    biometriaDispositivos = [];
  }
  biometriaLoaded = true;
  if (configLoaded) renderConfig();
}

/**
 * Se pide siempre fresco al servidor (en vez de usar lo que trajo el
 * login) para que "Tiene acceso" refleje el estado real — pudo cambiar
 * desde otra sesión, y el hash del PIN nunca vive en localStorage.
 */
async function load() {
  const content = document.getElementById('config-content');

  try {
    showLoader();
    const data = await getConfig(session.sheet_id);
    hideLoader();

    servicios = [...(data.servicios || [])];
    productos = [...(data.productos || [])];
    trabajadoras = (data.trabajadoras || []).map((t) => ({
      nombre: t.nombre,
      tiene_acceso: !!t.tiene_acceso,
    }));

    configLoaded = true;
    renderConfig();
  } catch (error) {
    hideLoader();
    content.innerHTML = `
      <div class="text-center" style="padding: 40px 0">
        <p style="color: var(--color-error); margin-bottom: 12px">Error al cargar la configuración</p>
        <button class="btn btn-outline" id="retry-config" style="max-width: 200px; margin: 0 auto">Reintentar</button>
      </div>
    `;
    document.getElementById('retry-config').addEventListener('click', load);
  }
}

// Eliminar servicio, producto o trabajadora; acciones de PIN de una
// trabajadora. Delegado sobre #config-content (ver init) — los botones que
// maneja se recrean en cada renderConfig(), pero la delegación los sigue
// alcanzando sin volver a registrarse.
function handleContentClick(e) {
  const delBtn = e.target.closest('.config-service-delete');
  if (delBtn) {
    confirmarEliminar(delBtn.dataset.type, parseInt(delBtn.dataset.index, 10));
    return;
  }

  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;

  if (actionBtn.dataset.action === 'toggle-seccion') {
    toggleSeccion(actionBtn.dataset.seccion);
    return;
  }
  const index = parseInt(actionBtn.dataset.index, 10);

  if (actionBtn.dataset.action === 'pin-toggle') {
    pinEditorIndex = pinEditorIndex === index ? -1 : index;
    renderConfig();
    const input = document.getElementById(`pin-input-${index}`);
    if (input) input.focus();
  } else if (actionBtn.dataset.action === 'pin-confirm') {
    confirmarPin(index);
  } else if (actionBtn.dataset.action === 'pin-remove') {
    quitarAcceso(index);
  } else if (actionBtn.dataset.action === 'notif-toggle') {
    toggleNotificaciones();
  } else if (actionBtn.dataset.action === 'biometria-activar') {
    activarBiometriaAqui();
  } else if (actionBtn.dataset.action === 'biometria-quitar') {
    quitarDispositivoBiometria(actionBtn.dataset.id);
  } else if (actionBtn.dataset.action === 'actualizar-app') {
    actualizarApp();
  }
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

/** Recordatorio de citas de mañana + aviso cuando una trabajadora registra
 * una cita — ver api/cron/reminder-citas.js y el hook en api/citas.js. */
function renderNotifSection() {
  if (notifStatus === 'loading') {
    return `
      <div class="config-worker-card">
        ${loadingHTML('Revisando notificaciones...')}
      </div>
    `;
  }

  if (notifStatus === 'unsupported') {
    const hint = isIOS() && !isStandalone()
      ? 'En iPhone/iPad, primero agrega la app a tu pantalla de inicio (ver el aviso en Inicio) — Safari no las soporta como pestaña normal.'
      : 'Este dispositivo o navegador no soporta notificaciones push.';
    return `
      <div class="config-worker-card">
        <div class="config-worker-top">
          <span class="config-service-name">Notificaciones push</span>
        </div>
        <p class="multi-select-hint">${hint}</p>
      </div>
    `;
  }

  const activo = notifStatus === 'subscribed';
  return `
    <div class="config-worker-card">
      <div class="config-worker-top">
        <span class="config-service-name">Notificaciones push</span>
        <span class="config-acceso-badge config-acceso-badge--${activo ? 'on' : 'off'}">
          ${activo ? 'Activadas' : 'Desactivadas'}
        </span>
      </div>
      <p class="multi-select-hint">Recordatorio de citas de mañana y aviso cuando una trabajadora registre una cita.</p>
      <div class="config-worker-actions">
        <button class="btn-link" data-action="notif-toggle">${activo ? 'Desactivar' : 'Activar'}</button>
      </div>
    </div>
  `;
}

/** Face ID/Touch ID — entrar sin teclear el PIN. Lista los dispositivos ya
 * activados (de esta identidad: dueña o esta trabajadora) y ofrece
 * activarlo en el dispositivo actual si lo soporta y no lo tiene ya. */
function renderBiometriaSection() {
  if (!biometriaLoaded) {
    return `<div class="config-worker-card">${loadingHTML('Revisando Face ID/Touch ID...')}</div>`;
  }

  const esteCredentialId = credentialIdDeEsteDispositivo();
  const listaDispositivos = biometriaDispositivos.length > 0 ? `
    <div class="biometria-device-list">
      ${biometriaDispositivos.map((d) => `
        <div class="biometria-device-row">
          <span class="biometria-device-nombre">
            ${escapeHTML(d.device_label || 'Dispositivo')}${d.credential_id === esteCredentialId ? ' <span style="color: var(--color-gray-400)">(este dispositivo)</span>' : ''}
          </span>
          <button class="btn-link" style="color: var(--color-error)" data-action="biometria-quitar" data-id="${escapeHTML(d.id)}">Quitar</button>
        </div>
      `).join('')}
    </div>
  ` : '';

  let accion = '';
  if (!biometriaSupported) {
    accion = '<p class="multi-select-hint">Este dispositivo no soporta Face ID/Touch ID.</p>';
  } else if (!biometriaActivaAqui) {
    accion = `
      <div class="config-worker-actions">
        <button class="btn-link" data-action="biometria-activar">Activar en este dispositivo</button>
      </div>
    `;
  }

  return `
    <div class="config-worker-card">
      <div class="config-worker-top">
        <span class="config-service-name">Face ID / Touch ID</span>
        ${biometriaDispositivos.length > 0 ? '<span class="config-acceso-badge config-acceso-badge--on">Activo</span>' : ''}
      </div>
      <p class="multi-select-hint">Entra sin teclear el PIN, con la biometría del celular.</p>
      ${listaDispositivos}
      ${accion}
    </div>
  `;
}

// Lo que se ejecuta al tocar "Sí, eliminar" en la confirmación
let eliminarPendiente = null;

const ELIMINAR_TIPO = {
  servicio: { titulo: '¿Eliminar este servicio?', lista: () => servicios },
  producto: { titulo: '¿Eliminar este producto?', lista: () => productos },
  trabajadora: { titulo: '¿Eliminar a esta trabajadora?', lista: () => trabajadoras },
};

/** Un toque por error en la ✕ no debe bastar para quitar algo del catálogo. */
function confirmarEliminar(type, index) {
  const tipo = ELIMINAR_TIPO[type];
  const item = tipo?.lista()[index];
  if (item === undefined) return;
  const nombre = type === 'trabajadora' ? item.nombre : item;
  const aviso = type === 'trabajadora'
    ? 'Se elimina en este momento, junto con su acceso a la app y su Face ID. Sus comisiones ya registradas no se borran.'
    : 'Se elimina en este momento. Las citas ya registradas no cambian.';

  document.getElementById('config-delete-title').textContent = tipo.titulo;
  document.getElementById('config-delete-text').innerHTML =
    `<strong>${escapeHTML(nombre)}</strong><br><br>${aviso}`;
  eliminarPendiente = () => {
    tipo.lista().splice(index, 1);
    renderConfig();
    // Servicios y productos se pueden recuperar al instante. Una trabajadora
    // no: el servidor le borra el PIN y el Face ID al quitarla.
    const deshacer = type === 'trabajadora' ? null : {
      label: 'Deshacer',
      onClick: () => {
        const lista = tipo.lista();
        if (lista.includes(item)) return;
        lista.splice(Math.min(index, lista.length), 0, item);
        renderConfig();
        guardarCatalogo(`Se recuperó ${nombre}`);
      },
    };
    guardarCatalogo(type === 'trabajadora' ? `Se eliminó a ${nombre}` : `Se eliminó ${nombre}`, deshacer);
  };
  document.getElementById('config-delete-modal').classList.remove('hidden');
}

function cerrarConfirmarEliminar() {
  eliminarPendiente = null;
  document.getElementById('config-delete-modal').classList.add('hidden');
}

/** Encabezado que contrae/despliega una sección (título + cuántos hay + flecha). */
function renderSeccionToggle(seccion, titulo, total, extraClass = '') {
  const abierta = seccionesAbiertas[seccion];
  return `
    <button type="button" class="config-seccion-toggle ${extraClass}" data-action="toggle-seccion"
      data-seccion="${seccion}" aria-expanded="${abierta}" aria-controls="seccion-${seccion}">
      <span class="config-seccion-titulo">${titulo}</span>
      <span class="config-seccion-count">${total}</span>
      <svg class="config-seccion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  `;
}

/** Sin re-renderizar: así no se pierde lo que se haya escrito en la otra
 * sección (ej. un producto a medio escribir). */
function toggleSeccion(seccion) {
  seccionesAbiertas[seccion] = !seccionesAbiertas[seccion];
  const abierta = seccionesAbiertas[seccion];
  document.getElementById(`seccion-${seccion}`)?.classList.toggle('hidden', !abierta);
  document.querySelector(`[data-action="toggle-seccion"][data-seccion="${seccion}"]`)
    ?.setAttribute('aria-expanded', String(abierta));
}

function renderConfig() {
  const content = document.getElementById('config-content');

  content.innerHTML = `
    <div class="step-content">
      <div class="config-notif-section">${renderNotifSection()}</div>
      <div class="config-notif-section">${renderBiometriaSection()}</div>

      <!-- Sección Servicios -->
      ${renderSeccionToggle('servicios', 'Servicios del salón', servicios.length)}
      <div class="config-seccion-body${seccionesAbiertas.servicios ? '' : ' hidden'}" id="seccion-servicios">
      <div id="servicios-list" class="gap-12">
        ${servicios.length === 0 ? `
          <p class="text-center" style="color: var(--color-gray-400); padding: 16px 0; font-size: 0.9rem">
            No hay servicios. Agrega uno abajo.
          </p>
        ` : servicios.map((s, i) => `
          <div class="config-service-item">
            <span class="config-service-name">${escapeHTML(s)}</span>
            <button class="config-service-delete" data-type="servicio" data-index="${i}" aria-label="Eliminar servicio ${escapeHTML(s)}">✕</button>
          </div>
        `).join('')}
      </div>
      <div class="config-add-row mt-16">
        <input type="text" class="input config-add-input" id="input-new-service"
          placeholder="Nuevo servicio" autocomplete="off">
        <button class="btn btn-gold config-add-btn" id="btn-add-service">Agregar</button>
      </div>
      </div>

      <!-- Sección Productos -->
      ${renderSeccionToggle('productos', 'Productos a la venta', productos.length, 'mt-8')}
      <div class="config-seccion-body${seccionesAbiertas.productos ? '' : ' hidden'}" id="seccion-productos">
      <div id="productos-list" class="gap-12">
        ${productos.length === 0 ? `
          <p class="text-center" style="color: var(--color-gray-400); padding: 16px 0; font-size: 0.9rem">
            No hay productos. Agrega uno abajo.
          </p>
        ` : productos.map((p, i) => `
          <div class="config-service-item">
            <span class="config-service-name">${escapeHTML(p)}</span>
            <button class="config-service-delete" data-type="producto" data-index="${i}" aria-label="Eliminar producto ${escapeHTML(p)}">✕</button>
          </div>
        `).join('')}
      </div>
      <div class="config-add-row mt-16">
        <input type="text" class="input config-add-input" id="input-new-product"
          placeholder="Nuevo producto" autocomplete="off">
        <button class="btn btn-gold config-add-btn" id="btn-add-product">Agregar</button>
      </div>
      </div>

      <!-- Sección Trabajadoras -->
      <label class="input-label mt-32">Trabajadoras con comisión</label>
      <p class="multi-select-hint">El porcentaje se asigna al registrar cada cita. Dale acceso a la app para que pueda ver la agenda y registrar sus propias citas.</p>
      <div id="trabajadoras-list" class="gap-12">
        ${trabajadoras.length === 0 ? `
          <p class="text-center" style="color: var(--color-gray-400); padding: 16px 0; font-size: 0.9rem">
            No hay trabajadoras registradas.
          </p>
        ` : trabajadoras.map((t, i) => `
          <div class="config-worker-card">
            <div class="config-worker-top">
              <span class="config-service-name">${escapeHTML(t.nombre)}</span>
              <span class="config-acceso-badge config-acceso-badge--${t.tiene_acceso ? 'on' : 'off'}">
                ${t.tiene_acceso ? 'Tiene acceso' : 'Sin acceso'}
              </span>
              <button class="config-service-delete" data-type="trabajadora" data-index="${i}" aria-label="Eliminar trabajadora ${escapeHTML(t.nombre)}">✕</button>
            </div>
            <div class="config-worker-actions">
              <button class="btn-link" data-action="pin-toggle" data-index="${i}">${t.tiene_acceso ? 'Cambiar PIN' : 'Dar acceso a la app'}</button>
              ${t.tiene_acceso ? `<button class="btn-link" style="color: var(--color-error)" data-action="pin-remove" data-index="${i}">Quitar acceso</button>` : ''}
            </div>
            <div class="config-worker-pin-editor hidden" id="pin-editor-${i}">
              <input type="text" class="input config-add-input" inputmode="numeric" maxlength="6"
                placeholder="PIN de 6 dígitos" id="pin-input-${i}">
              <button class="btn btn-gold config-add-btn" data-action="pin-confirm" data-index="${i}">Guardar</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="config-add-row mt-16">
        <input type="text" class="input config-add-input" id="input-worker-name"
          placeholder="Nombre de la trabajadora" autocomplete="off">
        <button class="btn btn-gold config-add-btn" id="btn-add-worker">Agregar</button>
      </div>

      <p class="config-autosave-hint mt-24">Los cambios se guardan solos.</p>

      ${versionAppHTML()}
    </div>
  `;
  pintarVersionApp();

  // El editor de PIN, si estaba abierto antes de re-renderizar, se queda abierto
  if (pinEditorIndex >= 0) {
    const editor = document.getElementById(`pin-editor-${pinEditorIndex}`);
    if (editor) editor.classList.remove('hidden');
  }

  // Agregar servicio
  const inputService = document.getElementById('input-new-service');
  const btnAddService = document.getElementById('btn-add-service');
  const addService = () => {
    const val = inputService.value.trim();
    if (!val) return;
    if (servicios.includes(val)) { showToast('Ese servicio ya existe', 'error'); return; }
    servicios.push(val);
    renderConfig();
    guardarCatalogo(`Se agregó ${val}`);
  };
  btnAddService.addEventListener('click', addService);
  inputService.addEventListener('keydown', (e) => { if (e.key === 'Enter') addService(); });

  // Agregar producto
  const inputProduct = document.getElementById('input-new-product');
  const btnAddProduct = document.getElementById('btn-add-product');
  const addProduct = () => {
    const val = inputProduct.value.trim();
    if (!val) return;
    if (productos.includes(val)) { showToast('Ese producto ya existe', 'error'); return; }
    productos.push(val);
    renderConfig();
    guardarCatalogo(`Se agregó ${val}`);
  };
  btnAddProduct.addEventListener('click', addProduct);
  inputProduct.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProduct(); });

  // Agregar trabajadora (solo nombre)
  const inputWorker = document.getElementById('input-worker-name');
  const addWorker = () => {
    const name = inputWorker.value.trim();
    if (!name) { showToast('Ingresa el nombre', 'error'); return; }
    if (trabajadoras.some((t) => t.nombre === name)) { showToast('Esa trabajadora ya existe', 'error'); return; }
    trabajadoras.push({ nombre: name, tiene_acceso: false });
    renderConfig();
    guardarCatalogo(`Se agregó a ${name}`);
  };
  document.getElementById('btn-add-worker').addEventListener('click', addWorker);
  inputWorker.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWorker(); });
}

/**
 * Asigna/cambia el PIN de una trabajadora. Espera a que termine cualquier
 * guardado pendiente: el endpoint de PIN exige que ella ya exista en el
 * catálogo, y si se acaba de agregar su guardado puede seguir en camino.
 */
async function confirmarPin(index) {
  const t = trabajadoras[index];
  const input = document.getElementById(`pin-input-${index}`);
  const pin = input.value.trim();

  if (!/^\d{6}$/.test(pin)) {
    showToast('El PIN debe ser de 6 dígitos', 'error');
    return;
  }

  try {
    showLoader();
    await colaGuardado;
    await setTrabajadorPin(session.sheet_id, { nombre: t.nombre, pin });
    hideLoader();
    t.tiene_acceso = true;
    pinEditorIndex = -1;
    renderConfig();
    showToast(`Acceso listo para ${t.nombre}`, 'success');
  } catch (error) {
    hideLoader();
    showToast(error.message || 'No se pudo guardar el PIN', 'error');
  }
}

async function toggleNotificaciones() {
  const activando = notifStatus !== 'subscribed';
  try {
    showLoader();
    if (activando) {
      const resultado = await activarNotificaciones(session.sheet_id);
      hideLoader();
      if (resultado === 'denied') {
        showToast('Permiso de notificaciones bloqueado — actívalo desde los ajustes del dispositivo', 'error');
        return;
      }
      notifStatus = 'subscribed';
      showToast('Notificaciones activadas', 'success');
    } else {
      await desactivarNotificaciones(session.sheet_id);
      hideLoader();
      notifStatus = 'unsubscribed';
      showToast('Notificaciones desactivadas', 'success');
    }
    renderConfig();
  } catch (error) {
    hideLoader();
    showToast(error.message || 'No se pudo actualizar notificaciones', 'error');
  }
}

async function activarBiometriaAqui() {
  try {
    showLoader();
    await activarBiometria({
      getOptions: getWebauthnRegisterOptions,
      verify: (body) => verifyWebauthnRegister(body),
    });
    hideLoader();
    biometriaActivaAqui = true;
    await loadBiometriaStatus();
    showToast('Face ID/Touch ID activado', 'success');
  } catch (error) {
    hideLoader();
    if (error.message === 'Cancelado') return;
    showToast(error.message || 'No se pudo activar Face ID/Touch ID', 'error');
  }
}

async function quitarDispositivoBiometria(id) {
  const dispositivo = biometriaDispositivos.find((d) => d.id === id);
  try {
    showLoader();
    await deleteWebauthnDevice(id);
    hideLoader();
    biometriaDispositivos = biometriaDispositivos.filter((d) => d.id !== id);
    // Si era este mismo dispositivo, limpiar la bandera local — si no, el
    // botón "Usar Face ID/Touch ID" del login seguiría apareciendo aunque
    // el servidor ya no tenga la credencial.
    if (dispositivo && dispositivo.credential_id === credentialIdDeEsteDispositivo()) {
      olvidarBiometriaEnEsteDispositivo();
      biometriaActivaAqui = false;
    }
    renderConfig();
    showToast('Face ID/Touch ID desactivado en ese dispositivo', 'success');
  } catch (error) {
    hideLoader();
    showToast(error.message || 'No se pudo quitar el dispositivo', 'error');
  }
}

async function quitarAcceso(index) {
  const t = trabajadoras[index];
  try {
    showLoader();
    await setTrabajadorPin(session.sheet_id, { nombre: t.nombre, remove: true });
    hideLoader();
    t.tiene_acceso = false;
    renderConfig();
    showToast(`Acceso quitado a ${t.nombre}`, 'success');
  } catch (error) {
    hideLoader();
    showToast(error.message || 'No se pudo quitar el acceso', 'error');
  }
}

// Guardados en fila: cada uno manda el catálogo completo tal como está al
// momento de salir, así dos cambios rápidos nunca se pisan ni llegan en
// desorden.
let colaGuardado = Promise.resolve();

/**
 * Guarda servicios, productos y trabajadoras tal como están en pantalla.
 * `mensaje` se muestra al terminar; `accion` es el botón opcional del aviso
 * (ej. "Deshacer"). Si falla, recarga desde el servidor para no dejar en
 * pantalla algo que en realidad no se guardó.
 */
function guardarCatalogo(mensaje, accion = null) {
  colaGuardado = colaGuardado.then(async () => {
    try {
      // El servidor nunca espera pin_hash/tiene_acceso aquí — eso se maneja
      // por separado en /api/trabajador-pin y el servidor lo conserva solo.
      const trabajadorasParaGuardar = trabajadoras.map((t) => ({ nombre: t.nombre }));
      await updateConfig(session.sheet_id, servicios, productos, trabajadorasParaGuardar);

      const currentSession = getSession();
      if (currentSession) {
        currentSession.servicios = [...servicios];
        currentSession.productos = [...productos];
        currentSession.trabajadoras = trabajadoras.map((t) => ({ ...t }));
        saveSession(currentSession);
      }

      showToast(mensaje, 'success', accion ? 5000 : 2000, accion);
    } catch (error) {
      showToast('No se pudo guardar. Revisa tu conexión e intenta de nuevo.', 'error');
      await load();
    }
  });
  return colaGuardado;
}
