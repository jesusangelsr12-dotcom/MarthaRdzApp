/**
 * Versión instalada + "Actualizar app" (discreto, al pie de la pantalla).
 * Lo usan Configuración (dueña) y el inicio de la trabajadora, que no tiene
 * acceso a Configuración pero también necesita poder actualizar.
 */

import { showLoader } from './utils.js';

let versionApp = null; // número de CACHE_NAME en sw.js ("jr-salones-v40" → "40")

export function versionAppHTML() {
  return `
    <p class="app-version">
      <span data-version-app></span><button type="button" class="btn-link app-version-btn" data-action="actualizar-app">Actualizar app</button>
    </p>
  `;
}

/** La versión instalada es el nombre del caché que dejó el service worker
 * (sw.js borra los viejos al activarse, así que queda uno solo). Se lee una
 * vez por carga de la app; las pantallas la vuelven a pintar al re-renderizar. */
export async function pintarVersionApp() {
  if (versionApp === null) {
    try {
      const keys = await caches.keys();
      const actual = keys.find((k) => k.startsWith('jr-salones-v'));
      versionApp = actual ? actual.replace('jr-salones-v', '') : '';
    } catch {
      versionApp = '';
    }
  }
  document.querySelectorAll('[data-version-app]').forEach((el) => {
    el.textContent = versionApp ? `Versión ${versionApp} · ` : '';
  });
}

/** Manual, por si algo se ve desactualizado: la app ya se actualiza sola
 * (ver registerSW en app.js), esto solo lo hace al momento. Se espera a
 * que la versión nueva, si la hay, quede activa antes de recargar — así la
 * recarga ya la usa y no hace falta una segunda. */
export async function actualizarApp() {
  showLoader();
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update();
      const nuevo = registration.installing || registration.waiting;
      if (nuevo) {
        await new Promise((resolve) => {
          const listo = () => nuevo.state === 'activated' || nuevo.state === 'redundant';
          if (listo()) return resolve();
          nuevo.addEventListener('statechange', () => { if (listo()) resolve(); });
          setTimeout(resolve, 8000); // sin conexión estable, no dejarla esperando
        });
      }
    }
  } catch {
    /* sin conexión: la recarga igual sirve lo que haya en caché */
  }
  window.location.reload();
}
