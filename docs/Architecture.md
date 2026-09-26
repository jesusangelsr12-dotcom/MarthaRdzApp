# Arquitectura · Martha Rdz Hair Artist

**Última revisión:** 2026-09-26

## 1. Vista general

```
┌─────────────────────────── Celular / iPad ───────────────────────────┐
│  PWA (public/)                                                       │
│  index.html → js/app.js (router hash) → js/views/*.js (pantallas)     │
│        │                     │                                        │
│        │ fetch /api/*         │ localStorage: jr_session (token + UI)  │
│        ▼                     │                                        │
│  sw.js (Service Worker): caché de assets, API network-only, push      │
└────────┬───────────────────────────────────────────────▲─────────────┘
         │ HTTPS  Authorization: Bearer <token>           │ Web Push
         ▼                                                │
┌─────────────────────────── Vercel ───────────────────────────────────┐
│  Static hosting (public/)   +   Serverless Functions (api/*.js)       │
│                                   │  lib/auth.js   lib/validate.js    │
│  Vercel Cron 00:00 UTC ──────────►│  lib/db.js     lib/push.js ───────┼──► Push service
│                                   │  lib/webauthn.js                  │    (Apple / Google)
└───────────────────────────────────┼──────────────────────────────────┘
                                    │ HTTPS (driver HTTP de Neon)
                                    ▼
                           ┌────────────────────┐
                           │ Neon · PostgreSQL  │
                           └────────────────────┘

Salida a terceros desde el navegador (no pasa por el backend):
  wa.me (WhatsApp click-to-chat) · navigator.share (hoja nativa de compartir)
```

## 2. Principios que guían el diseño

1. **Sin build.** El navegador carga módulos ES tal cual están en `public/js/`.
   Nada de bundler, transpilador ni framework. Menos piezas que se rompan.
2. **El servidor es la única fuente de verdad sobre permisos.** El frontend
   oculta botones por comodidad; el backend es el que bloquea.
3. **El salón sale del token, nunca del cliente.** Ningún endpoint confía en
   un `salon_id` o `sheet_id` que mande el navegador.
4. **Borrar nunca destruye.** Todo borrado es lógico (`deleted_at`) y tiene "Deshacer".
5. **Serverless sin estado.** No hay tabla de sesiones: tokens y challenges
   van firmados con HMAC y el cliente los regresa.
6. **Aditivo.** Las migraciones solo agregan columnas y tablas.

## 3. Frontend

### 3.1 Piezas

| Archivo | Responsabilidad |
|---|---|
| `public/index.html` | Contenedor `#app`, toast, loader global, meta de iOS, splash screens |
| `js/app.js` | Router por hash, guardas de sesión y rol, layout iPad, registro del SW y recarga en actualización |
| `js/auth.js` | Sesión en `localStorage` (`jr_session`), rol y nombre de la trabajadora |
| `js/api.js` | Cliente HTTP. Una función por operación. Agrega el token |
| `js/utils.js` | Moneda, fechas, escape de HTML, toast, loader, `normalizeNombre` |
| `js/hora-picker.js` | Selector de hora 12 h con minutos de 10 en 10 (guarda 24 h) |
| `js/whatsapp.js` | Links `wa.me` y hoja nativa de compartir |
| `js/push-client.js` | Permiso y suscripción push del dispositivo |
| `js/webauthn-client.js` | Ceremonias de Face ID / Touch ID en el navegador |
| `js/install-banner.js` | Aviso "Agregar a inicio" en iOS / Safari |
| `js/app-version.js` | Versión instalada y botón "Actualizar app" |
| `js/views/*.js` | Una pantalla por archivo |
| `fonts/dejavu-serif-bold.woff2` | Letra del logo para los títulos (subconjunto, 19 KB). Licencia en `fonts/LICENSE-DejaVu.txt` |

### 3.2 Contrato de una vista

Cada vista exporta dos funciones y nada más las usa el router:

```js
export function render(session) { return '<div class="screen">…</div>'; } // HTML como string
export function init(session)   { /* listeners, cargas de datos */ }
```

El router hace `app.innerHTML = view.render(session)` y luego `view.init(session)`.
El estado de cada pantalla vive en variables del módulo y **se reinicia en
`init()`**, porque el módulo se queda cargado entre visitas.

### 3.3 Rutas

| Hash | Vista | Dueña | Trabajadora | Layout en iPad |
|---|---|:---:|:---:|---|
| `#login` | login.js | ✅ | ✅ | angosto |
| `#home` | home.js | ✅ | ✅ (versión reducida) | 2 columnas (solo dueña) |
| `#cita` | cita.js | ✅ | ✅ | angosto |
| `#agenda` | agenda.js | ✅ | ✅ | 2 columnas |
| `#agendar?fecha=YYYY-MM-DD` | agendar.js | ✅ | ✅ | angosto |
| `#gasto` | gasto.js | ✅ | ❌ | angosto |
| `#registros` | registros.js | ✅ | ❌ | normal |
| `#comisiones` | comisiones.js | ✅ | ❌ | normal |
| `#historial` | historial.js | ✅ | ❌ | normal |
| `#dashboard` | dashboard.js | ✅ | ❌ | normal |
| `#config` | config.js | ✅ | ❌ | normal |

Guardas del router, en este orden:
1. Sin sesión y fuera de `login` → `#login`.
2. Con sesión y en `login` → `#home`.
3. Trabajadora en una ruta fuera de `RUTAS_TRABAJADORA` → `#home`.

### 3.4 Sesión en el navegador

`localStorage['jr_session']` guarda lo que devolvió el login: `token`,
`salon_nombre`, `sheet_id` (uuid del salón), `servicios`, `productos`,
`trabajadoras` (`{nombre, tiene_acceso}`), `role`, `worker_nombre`,
`created_at` y `expires_at`.

Solo `token` tiene valor de seguridad. El resto es para pintar la UI.

Otras llaves: `jr_install_banner_dismissed`, `jr_biometria_activa`, `jr_biometria_credential_id`.

### 3.5 Service Worker y actualizaciones

| Tipo de request | Estrategia |
|---|---|
| `/api/*` | Solo red. Sin conexión responde `503 {"error":"Sin conexión a internet"}` |
| `.js`, `.css`, `index.html`, `/` | Red primero; si falla, caché |
| Imágenes, íconos, manifest | Caché primero |

Flujo de actualización:

1. Un deploy sube `CACHE_NAME` (hoy `jr-salones-v47`).
2. Al volver la app al frente (`visibilitychange`), `registration.update()` baja el SW nuevo.
3. El SW nuevo hace `skipWaiting()` + `clients.claim()` y borra cachés viejos.
4. `app.js` marca `actualizacionPendiente` y recarga en el siguiente cambio de hash.

> `app.js` se carga **sin** query string a propósito. Con `?v=…` el navegador
> lo trata como otro módulo y la app se carga dos veces (ver commit `c35484a`).

## 4. Backend

### 4.1 Serverless functions

Vercel Hobby permite **12 funciones por deploy. Hoy hay 12.** Agregar un
endpoint nuevo obliga a fusionarlo con uno existente (así se hizo con
`webauthn.js` y con ausencias dentro de `citas-agendadas.js`).

| Función | Métodos | Rol mínimo |
|---|---|---|
| `api/login.js` | POST | público (rate limit) |
| `api/webauthn.js` | GET, POST, DELETE | público para login; sesión para lo demás |
| `api/citas.js` | GET, POST, PATCH, DELETE | POST: trabajadora · resto: dueña |
| `api/citas-agendadas.js` | GET, POST, PATCH, DELETE | GET y POST cita: trabajadora · resto: dueña |
| `api/clientas.js` | GET, POST | lista: trabajadora (sin datos personales) · historial y POST: dueña |
| `api/gastos.js` | GET, POST, PATCH, DELETE | dueña |
| `api/comisiones.js` | GET | dueña |
| `api/dashboard.js` | GET | dueña |
| `api/config.js` | GET, POST | dueña |
| `api/trabajador-pin.js` | POST | dueña |
| `api/push-subscribe.js` | GET, POST, DELETE | dueña |
| `api/cron/reminder-citas.js` | GET | Vercel Cron (`CRON_SECRET`) |

Detalle de cada uno en [API-Guide.md](API-Guide.md).

### 4.2 Librerías compartidas (`lib/`)

| Archivo | Qué hace |
|---|---|
| `db.js` | `getSql()`: cliente `neon()` reutilizado entre invocaciones. Cada query es una request HTTPS, sin pool |
| `auth.js` | Crear y verificar tokens, `requireSession`, `requireOwnerSession`, `getSessionRole`, hash de PIN, `sanitizeTrabajadoras` |
| `validate.js` | Validadores de entrada (fechas, horas, montos, PIN, teléfono, método de pago, estado) |
| `push.js` | `enviarPushSalon()`: manda a todos los dispositivos del salón y limpia suscripciones muertas (404/410) |
| `webauthn.js` | Configuración de RP según el host y challenges firmados |
| `fecha.js` | `fechaMexico()`: la fecha de hoy en Ciudad de México. Lo que fecha el servidor la usa, nunca la de UTC |

### 4.3 Anatomía de un handler

```js
module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);   // o requireOwnerSession
  if (!salonId) return;                        // ya respondió 401/403
  const { role, worker } = getSessionRole(req);

  try {
    const sql = getSql();
    if (req.method === 'GET') { /* validar → consultar → mapear → 200 */ }
    if (req.method === 'POST') { /* validar → permisos por rol → insertar → 201 */ }
    res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en <recurso>:', error);
    res.status(500).json({ error: 'Error al procesar <recurso>' });
  }
};
```

## 5. Conexiones entre sistemas

| Desde | Hacia | Cómo | Para qué |
|---|---|---|---|
| Navegador | Vercel `/api/*` | `fetch` + JSON + Bearer token | Todo el CRUD |
| Serverless | Neon | Driver HTTP `@neondatabase/serverless` | Consultas SQL parametrizadas |
| Vercel Cron | `/api/cron/reminder-citas` | GET diario 00:00 UTC | Recordatorio de citas de mañana |
| Serverless | Apple / Google push | `web-push` con VAPID | Notificaciones a la dueña |
| Navegador | Enclave del dispositivo | WebAuthn (`navigator.credentials`) | Face ID / Touch ID |
| Navegador | WhatsApp | `https://wa.me/52XXXXXXXXXX?text=…` | Confirmar citas, recibos |
| Navegador | App de compartir | `navigator.share` | Recibos por cualquier app |
| Navegador | Google Fonts | CSS de Inter | Tipografía |

## 6. Decisiones de arquitectura

| Decisión | Por qué | Costo aceptado |
|---|---|---|
| Vanilla JS sin build | Cero herramientas que mantener; cualquiera edita y despliega | HTML como strings; `normalizeNombre` duplicada front/back |
| Token HMAC propio, no JWT de librería | Una función, cero dependencias, fácil de auditar | No hay revocación antes de las 8 h |
| Identificar cita por `(fecha, timestamp, clienta)` | Heredado de cuando los datos vivían en Google Sheets | Frágil si dos citas coinciden al segundo |
| Catálogo y trabajadoras en `jsonb` dentro de `salones` | Se leen y guardan completos, nunca por partes | Renombrar una trabajadora rompe el vínculo con sus comisiones y su PIN |
| Anticipo como fila de `citas` con item `tipo: anticipo` | El dinero entra el día que se recibe y aparece en Registros y Dashboard | Hay que excluirlo al contar visitas y al rankear |
| Endpoints fusionados (`webauthn`, ausencias) | Límite de 12 funciones | Handlers más largos, se distinguen por `mode`/`action`/`recurso` |

## 7. Límites y escalabilidad

- **Volumen esperado:** decenas de citas al día por salón. Todo cabe en consultas simples.
- **Historial de clientas** trae todas las citas del salón en una llamada. Con miles de citas conviene paginar o agregar en SQL.
- **Login** busca el PIN en todos los salones. Con muchos salones habrá que indexar `pin_hash_v2`.
- **Funciones:** en el límite (12/12). Pasar a Vercel Pro o fusionar antes de agregar otra.
