/**
 * Banner para invitar a "Agregar a inicio" en iOS — a diferencia de
 * Android/Chrome, Safari no ofrece instalar la PWA sola. Sin este aviso,
 * quien no sepa hacerlo desde Compartir sigue usando la app como una
 * pestaña normal (sin splash, sin ícono propio, sin las áreas seguras
 * del notch que ya tiene resuelta la versión instalada).
 */

const DISMISSED_KEY = 'jr_install_banner_dismissed';

function isIOS() {
  const ua = navigator.userAgent;
  // iPadOS 13+ se reporta como "Macintosh" — se distingue de una Mac de
  // verdad porque además tiene pantalla táctil.
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafari() {
  const ua = navigator.userAgent;
  // Chrome/Firefox en iOS corren sobre el motor de Safari por regla de
  // Apple, pero no pueden instalar a pantalla de inicio — se distinguen
  // por su propio string en el user agent.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

/** true si conviene mostrar el banner: iOS + Safari + no instalada + no cerrado antes */
export function shouldShowInstallBanner() {
  try {
    if (localStorage.getItem(DISMISSED_KEY)) return false;
  } catch {
    return false; // localStorage bloqueado (modo privado, etc.) — no insistir
  }
  return isIOS() && isSafari() && !isStandalone();
}

export function installBannerHTML() {
  return `
    <div class="install-banner" id="install-banner">
      <button class="install-banner-close" id="install-banner-close" aria-label="Cerrar aviso">✕</button>
      <p class="install-banner-title">Agrega la app a tu pantalla de inicio</p>
      <p class="install-banner-text">
        Toca <span class="install-banner-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>
          </svg>
        </span> <strong>Compartir</strong>, abajo en Safari, y luego <strong>"Agregar a pantalla de inicio"</strong> — así entras directo, sin buscarla en el navegador.
      </p>
    </div>
  `;
}

/** Engancha el botón de cerrar — llamar después de insertar installBannerHTML() en el DOM */
export function initInstallBanner() {
  const btn = document.getElementById('install-banner-close');
  if (!btn) return;
  btn.addEventListener('click', () => {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
    document.getElementById('install-banner')?.remove();
  });
}
