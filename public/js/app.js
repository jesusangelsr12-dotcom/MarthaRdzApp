/**
 * App Entry Point
 * Router SPA hash-based + registro del Service Worker
 */

import { isAuthenticated, getSession, isTrabajadora } from './auth.js';
import * as loginView from './views/login.js';
import * as homeView from './views/home.js';
import * as citaView from './views/cita.js';
import * as gastoView from './views/gasto.js';
import * as registrosView from './views/registros.js';
import * as comisionesView from './views/comisiones.js';
import * as historialView from './views/historial.js';
import * as configView from './views/config.js';
import * as dashboardView from './views/dashboard.js';

const routes = {
  login: loginView,
  home: homeView,
  cita: citaView,
  gasto: gastoView,
  registros: registrosView,
  comisiones: comisionesView,
  historial: historialView,
  config: configView,
  dashboard: dashboardView,
};

/** Navega a una ruta */
export function navigateTo(route) {
  window.location.hash = `#${route}`;
}

/** Obtiene la ruta actual del hash (sin un "?..." que pudiera traer: esta
 * función solo necesita el nombre de la ruta). */
function getCurrentRoute() {
  return window.location.hash.replace('#', '').split('?')[0] || 'login';
}

// Una trabajadora solo puede llegar a estas rutas (registrar cita) — el
// resto (dinero, clientas, configuración) es solo de la dueña.
// El backend ya rechaza esas llamadas con 403; esto es solo para no
// mostrarle una pantalla que le va a fallar si teclea el hash a mano.
const RUTAS_TRABAJADORA = new Set(['login', 'home', 'cita']);

// En iPad, un wizard paso-a-paso (capturar un monto, elegir servicios) se
// siente mejor angosto y centrado — igual que en celular, solo con más
// aire. Las pantallas de lista/panel si aprovechan el ancho extra: Home
// con dos columnas de verdad, el resto con más espacio de lectura.
const RUTAS_ANGOSTAS = new Set(['login', 'cita', 'gasto']);
const RUTAS_DOS_COLUMNAS = new Set(['home']);

/** Renderiza la vista correspondiente a la ruta actual */
function renderCurrentRoute() {
  const route = getCurrentRoute();
  const view = routes[route];

  // Si no está autenticado y no está en login, redirigir
  if (route !== 'login' && !isAuthenticated()) {
    navigateTo('login');
    return;
  }

  // Si está autenticado y está en login, ir a home
  if (route === 'login' && isAuthenticated()) {
    navigateTo('home');
    return;
  }

  if (isTrabajadora() && !RUTAS_TRABAJADORA.has(route)) {
    navigateTo('home');
    return;
  }

  // Una ruta que ya no existe (ej. "#agenda" de un acceso o una
  // notificación de antes de la v50) dejaba la pantalla en blanco.
  if (!view) {
    navigateTo('home');
    return;
  }

  const app = document.getElementById('app');
  // El home de una trabajadora es chico (1 tarjeta) — no necesita el
  // layout de dos columnas pensado para el de la dueña.
  const dosColumnas = RUTAS_DOS_COLUMNAS.has(route) && !(route === 'home' && isTrabajadora());
  app.classList.toggle('app--angosta', RUTAS_ANGOSTAS.has(route));
  app.classList.toggle('app--dos-columnas', dosColumnas);

  app.innerHTML = view.render(getSession());
  view.init(getSession());
}

// true cuando ya hay una versión nueva de la app activa pero la pantalla
// abierta sigue corriendo el código viejo (ver registerSW)
let actualizacionPendiente = false;

/** Registra el Service Worker y mantiene la app al día: cada deploy cambia
 * CACHE_NAME en sw.js, y la versión nueva toma control sola (skipWaiting +
 * clients.claim). Lo que falta es que la pantalla ya abierta cargue el
 * código nuevo — la app instalada en el celular puede quedarse abierta días. */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  // Sin controlador previo es la primera instalación: no hay nada viejo
  // que reemplazar, así que no se recarga.
  const habiaVersionPrevia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // No se recarga aquí mismo: podría estar a media captura (o haber
    // salido a WhatsApp a buscar un número). Se espera a que cambie de
    // pantalla, ver onHashChange.
    if (habiaVersionPrevia) actualizacionPendiente = true;
  });

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    // Buscar versión nueva cada vez que la app vuelve al frente
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch (err) {
    console.warn('SW registration failed:', err);
  }
}

function onHashChange() {
  // Cambiar de pantalla ya descarta lo que había en la anterior: buen
  // momento para cargar la versión nueva sin que se pierda nada.
  if (actualizacionPendiente) {
    window.location.reload();
    return;
  }
  renderCurrentRoute();
}

// --- Inicialización ---
function init() {
  registerSW();

  // Escuchar cambios de ruta
  window.addEventListener('hashchange', onHashChange);

  // Render inicial
  renderCurrentRoute();
}

document.addEventListener('DOMContentLoaded', init);
