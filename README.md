# Martha Rdz Hair Artist

PWA para administrar un salón de belleza desde el celular: agenda de citas,
cobro de servicios y productos, comisiones de trabajadoras, gastos, historial
de clientas y un dashboard del negocio.

Es la app de Martha Rdz Hair Artist. Soporta varios salones en la
misma base de datos (una base de Neon propia, separada de cualquier otra app). Cada salón entra con su propio PIN.

> Proyecto privado de JR Consulting.

## Qué hace, en corto

| Para la dueña | Para una trabajadora (acceso limitado) |
|---|---|
| Registrar citas (servicios, productos, precios, comisiones, fórmula, pago) | Registrar citas y asignarse su propia comisión |
| Agendar citas futuras con anticipo (y corregirlo) y confirmarlas por WhatsApp | Ver la agenda completa y agendar citas |
| Registrar gastos | |
| Ver registros del día, corregir el monto de un cobro, borrar con "Deshacer" y compartir recibos | |
| Historial de clientas con fórmulas, nota fija y teléfono | |
| Reporte de comisiones y dashboard mensual | |
| Configurar catálogo, trabajadoras y sus PINs | |
| Notificaciones push y Face ID / Touch ID | |

El detalle de qué ve y qué no ve cada rol está en [docs/PRD.md](docs/PRD.md)
y en [CLAUDE.md](CLAUDE.md).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (módulos ES), sin build |
| Backend | Vercel Serverless Functions (Node.js, CommonJS) |
| Base de datos | Neon (PostgreSQL serverless, driver HTTP) |
| Autenticación | PIN de 6 dígitos → token HMAC de 8 h. Face ID / Touch ID opcional (WebAuthn) |
| Notificaciones | Web Push (VAPID) + Vercel Cron |
| PWA | Service Worker + Web App Manifest + splash de iOS |

## Correrlo en local

Requisitos: Node.js 18 o más nuevo, la CLI de Vercel y acceso a una base de
datos Neon (o cualquier Postgres).

```bash
npm install
cp .env.example .env      # y llena los valores (ver abajo)
npm run dev               # vercel dev → http://localhost:3000
```

Variables mínimas para entrar a la app:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a Postgres (Neon) |
| `SESSION_SECRET` | Firma los tokens de sesión y los challenges de Face ID |
| `PIN_PEPPER` | Se combina con el PIN para calcular su hash |

Opcionales: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (push) y
`CRON_SECRET` (protege el recordatorio diario). La lista completa y cómo
generarlas está en [docs/Deployment.md](docs/Deployment.md).

> Face ID / Touch ID y las notificaciones push necesitan HTTPS. En
> `localhost` el navegador las permite, pero en una IP de tu red local no.

### Base de datos

Todo el esquema vive en `scripts/migrations/`: `000_base.sql` crea las
tablas base (`salones`, `citas`, `clientas`, `comisiones`, `gastos`) y de la
`001` a la `007` agregan el resto. Se aplican en orden:

```bash
for f in scripts/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Todas son aditivas (`if not exists`), así que correrlas dos veces no rompe
nada. El esquema completo está en [docs/Database.md](docs/Database.md).

### Dar de alta un salón

La app no tiene pantalla para crear salones. Se hace con un script:

```bash
# Salón con PIN listo para entrar
npm run crear-salon -- --nombre "Mi Salón" --pin 123456

# Copiando servicios, productos y trabajadoras de otro salón
npm run crear-salon -- --nombre "Mi Salón" --pin 123456 --plantilla salon_002
```

El script **siempre crea un salón nuevo**. No sirve para cambiarle el PIN a
uno existente; eso se hace hoy directo en la base de datos (ver
[docs/Deployment.md](docs/Deployment.md#cambiar-el-pin-de-una-dueña)).

### Pruebas

```bash
npm test
```

Corre con `node --test`. Las pruebas de integración levantan un Postgres
dentro del proceso (PGlite, dependencia de desarrollo), así que no necesitas
base de datos ni variables de entorno. Qué cubre y qué no, en
[docs/Testing.md](docs/Testing.md).

## Estructura

```
api/                  Serverless functions (una por archivo, máximo 12 en Vercel Hobby)
  cron/               Tareas programadas (recordatorio diario)
lib/                  Código compartido del backend (auth, db, validación, push, webauthn)
public/               Todo lo que se sirve al navegador
  js/views/           Una pantalla por archivo (render + init)
  js/                 Router, cliente de API, sesión y utilidades
  css/styles.css      Design system completo
  sw.js               Service Worker (subir CACHE_NAME en cada deploy)
scripts/              Alta de salones y migraciones SQL
test/                 Pruebas con node --test
docs/                 Documentación del proyecto
```

## Documentación

| Documento | Qué responde |
|---|---|
| [PRD](docs/PRD.md) | Qué se construye, para quién y qué debe hacer |
| [Architecture](docs/Architecture.md) | Cómo se estructura y cómo se conectan las piezas |
| [Design System](docs/Design-System.md) | Colores, tipografía, espaciado, componentes y reglas UI/UX |
| [Database](docs/Database.md) | Tablas, relaciones y reglas de los datos |
| [API Guide](docs/API-Guide.md) | Cada endpoint: método, permisos, entrada y salida |
| [Code Style](docs/Code-Style.md) | Convenciones para escribir código en este repo |
| [Security](docs/Security.md) | Cómo se protegen la app, los datos y los secretos |
| [Testing](docs/Testing.md) | Qué se prueba y cuándo algo está "terminado" |
| [Error Handling](docs/Error-Handling.md) | Cómo se manejan, muestran y registran los errores |
| [Deployment](docs/Deployment.md) | Ambientes, variables y pasos para publicar |
| [CHANGELOG](CHANGELOG.md) | Qué cambió y cuándo |
| [AppFlow](docs/AppFlow.md) | Mapa de flujos de punta a punta y cabos sueltos |
| [AppFlow (tablero)](docs/AppFlow.html) | Los mismos flujos en un tablero interactivo tipo Miro: arrastra, acerca y aleja, busca y filtra por rol. Ábrelo en el navegador |

Estos documentos se actualizan en cada cambio, no una sola vez. La regla
está en [CLAUDE.md](CLAUDE.md).

## Licencia

Proyecto privado. JR Consulting.
