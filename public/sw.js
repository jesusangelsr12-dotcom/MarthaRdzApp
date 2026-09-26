const CACHE_NAME = 'jr-salones-v47';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/img/logo.png',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/utils.js',
  '/js/install-banner.js',
  '/js/whatsapp.js',
  '/js/push-client.js',
  '/js/webauthn-client.js',
  '/js/hora-picker.js',
  '/js/app-version.js',
  '/js/views/login.js',
  '/js/views/home.js',
  '/js/views/cita.js',
  '/js/views/gasto.js',
  '/js/views/registros.js',
  '/js/views/comisiones.js',
  '/js/views/historial.js',
  '/js/views/config.js',
  '/js/views/dashboard.js',
  '/js/views/agenda.js',
  '/js/views/agendar.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// Assets that should use network-first strategy (code & styles change often)
const NETWORK_FIRST_PATTERNS = [
  /\.css(\?.*)?$/,
  /\.js(\?.*)?$/,
  /\/index\.html(\?.*)?$/,
  /\/$/
];

function isNetworkFirst(url) {
  const pathname = new URL(url).pathname + new URL(url).search;
  return NETWORK_FIRST_PATTERNS.some((p) => p.test(pathname));
}

// Instalar: cachear assets est\u00e1ticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos + tomar control inmediato
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first para JS/CSS/HTML, cache-first para im\u00e1genes/fonts, network-only para API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network-only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Sin conexi\u00f3n a internet' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // JS, CSS, HTML: network-first (always get latest, fallback to cache)
  if (url.origin === self.location.origin && isNetworkFirst(request.url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else (images, fonts, manifest): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Notificaciones push: recordatorio de citas de mañana, aviso de cita nueva
// registrada por una trabajadora (ver lib/push.js).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'Martha Rdz Hairartist';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// Tocar la notificación enfoca la app si ya está abierta, o la abre en la
// pantalla correspondiente (Agenda para el recordatorio, Registros para el
// aviso de cita nueva) en vez de siempre mandar al Home.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
