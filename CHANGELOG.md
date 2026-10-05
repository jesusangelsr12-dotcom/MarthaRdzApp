# Changelog

Todo cambio que llega a producción se anota aquí. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

La **versión de la app** es el número de `CACHE_NAME` en `public/sw.js`
(`jr-salones-v45` → v45). Es el mismo número que se ve en Configuración.

Cada entrada agrupa las versiones publicadas en un mismo bloque de trabajo
y lleva el número de la última.

Secciones: **Agregado** · **Cambiado** · **Corregido** · **Seguridad** · **Base de datos** · **Docs**.

## [Sin publicar]

## v50 · 2026-10-05

### Agregado
- **Corregir el anticipo desde la Agenda.** El botón "Editar nota" ahora es **"Editar anticipo y nota"**: un solo editor con el monto, cómo se pagó y la nota (sin botones nuevos en el menú). Su ingreso en Registros se corrige solo, en el día en que se recibió; si no había anticipo, entra hoy; en $0 se quita. No aplica a una cita ya cobrada.
- **Corregir el cobro de una cita ya registrada.** En Ver Registros, tocar el monto (✎) abre un editor con el precio de cada servicio/producto y el método de pago. El total se ve al momento, descontando el anticipo si vino de la Agenda, y sus comisiones se recalculan con el mismo %.
- **"Ver cobro en Registros"** en el menú de una cita ya cobrada: abre Registros en ese día con su cobro resaltado, y "← Atrás" regresa a la Agenda. Antes solo decía "corrígelo en Ver Registros".
- El menú de una cita muestra su anticipo y cómo se pagó.

### Cambiado
- `PATCH /api/citas-agendadas` acepta `anticipo` (+ método y `timestamp`). `PATCH /api/citas` acepta `items` + `metodo_pago` para corregir un cobro. `GET /api/citas` agrega `agenda_id` y `anticipo_agenda`.
- Los menús y hojas de acciones tienen alto máximo con scroll, y "Cancelar"/"Guardar" ya caben en un celular de 320 px.

### Docs
- PRD, API Guide, Database (reglas 5 y 6), Design System, Security, Error Handling, Testing (48 pruebas), AppFlow (F5, F8, mapa del dinero; .md y tablero) y README.
- Nuevo cabo suelto **C15** (abierto): borrar en Registros el cobro de una cita agendada la deja "Completada" sin cobro.

## v49 · 2026-09-26

### Agregado
- **Permisos por trabajadora.** En Configuración, cada trabajadora tiene "Puede usar" con el interruptor **Teléfonos de clientas** (apagado por default). Con él puede agregar y cambiar el teléfono de la clienta al agendar y en el menú de una cita pendiente, y "Confirmar por WhatsApp". Nunca ve ni cambia la nota fija (alergias).
- El permiso se guarda al tocar el interruptor y vale al momento, sin que ella cierre sesión.

### Seguridad
- El servidor revisa el permiso en cada llamada (`permisosDeTrabajadora()`). Sin él, `GET /api/clientas` no le manda teléfonos y `POST` responde 403. Con él, `POST` solo guarda el teléfono.
- `POST /api/config` ya solo toma el nombre de cada trabajadora: no se le puede colar un `pin_hash` ni permisos al guardar el catálogo.

### Corregido
- Los avisos (toast) salían detrás de los menús y modales abiertos: un error como "El teléfono debe tener 10 dígitos" no se veía. Ahora van encima.

### Docs
- CLAUDE.md, PRD, Security, API Guide, Database, Testing (43 pruebas), AppFlow (F4 y F11, .md y tablero) y Design System (interruptor).

## v48 · 2026-09-26

### Cambiado
- Configuración se guarda sola: ya no existe el botón "Guardar Cambios". Agregar o quitar un servicio, producto o trabajadora se guarda al momento, con el aviso "Se agregó…" o "Se eliminó…".
- Quitar un servicio o producto ofrece "Deshacer" en el aviso. Quitar a una trabajadora sigue pidiendo confirmación y avisa que pierde su acceso y su Face ID.
- A una trabajadora recién agregada se le puede dar PIN de inmediato.

### Corregido
- Los avisos con botón (ej. "Deshacer") ya no se parten en varios renglones: toman el ancho de su texto.

### Docs
- PRD, AppFlow (F11 en el .md y el tablero) y Design System con el guardado automático.

## v47 · 2026-09-26

La app se separa como **Martha Rdz Hair Artist**, con su propio repositorio y su propia base de datos de Neon.

### Cambiado
- Nombre, textos, manifest, título, notificaciones y Face ID dicen Martha Rdz Hair Artist.
- Logo real de la marca ("MARTHA RDZ." + "HAIR ARTIST"). Monograma cuadrado "MR." con la misma tipografía para los íconos de la app (Android e iOS) y el logo sobre Blanco Humo en las 21 pantallas de carga de iOS.
- Paleta del brand board: Negro Elegancia `#111111`, Verde Menta `#88D8C0` (botón principal, con texto negro), Blanco Humo `#F4F4F4` (fondo) y Gris Plata `#E2E2E2` (bordes). Menta profundo `#13705F` para texto de acento y un tono "slate" como segundo color. Todo con contraste WCAG AA.
- El verde de dinero y éxito pasa a un verde clásico (`#2B7330`) para no confundirse con el menta: "Pendiente" y "Completada" se distinguen a simple vista.
- Títulos de pantalla y de avisos con la letra del logo (DejaVu Serif Bold), como pide el brand board. La fuente va dentro de la app (`public/fonts/`, 19 KB) y funciona sin conexión; el resto del texto sigue en Inter.
- Tokens renombrados: `--color-pink*` → `--color-accent*` y `--color-rose*` → `--color-slate*`.
- Nuevo mensaje para confirmar una cita por WhatsApp: "Hola! Te escribo de Martha Rdz Hair Artist para confirmar tu próxima cita el día viernes 9 de octubre a las 4:30 PM. ¿Confirmas tu cita? Gracias!" (dice "a la 1:00" en singular).

### Corregido
- Colores sueltos que no eran de la paleta (dorado en el foco de inputs, crema en el loader, café en el fondo de modales y sombras) ahora salen de la marca.

### Base de datos
- La base "Martha Rdz App" (Neon) ya tenía el esquema completo de 000 a 007 y los datos de Martha. Se revisaron tablas, columnas, índices y restricciones: no faltaba nada. El salón se llama ahora "Martha Rodriguez Hair Artist".

### Docs
- Todos los documentos con el nombre nuevo. Design System con la paleta y el logo nuevos. Deployment explica la primera instalación y el estado de la base. El tablero AppFlow usa la paleta nueva.

## v46 · 2026-09-26

Se resuelven los 14 cabos sueltos que encontró AppFlow.

### Corregido
- **C1** Eliminar desde la Agenda una cita ya cobrada borraba también el ingreso de esa visita y dejaba sus comisiones contando. Ahora una cita completada no se elimina desde la Agenda (el cobro se corrige en Ver Registros), y eliminar una pendiente borra solo su anticipo.
- **C2** Un anticipo cobrado después de las 6 pm quedaba registrado como ingreso del día siguiente. El servidor ahora usa la fecha de Ciudad de México (`lib/fecha.js`) en el anticipo, en la ficha de clientas y en el cron.
- **C3** Cobrar una cita agendada ya es una sola operación: si algo falla, no queda la cita marcada como completada sin su cobro.
- **C4** Con la sesión vencida, la app se quedaba mostrando "Error al cargar…". Ahora regresa a Login con el aviso "Tu sesión expiró", y guardar Configuración ya no alarga la sesión solo en el celular.
- **C7** Si en Registrar Cita tocabas el recuadro de una cita agendada y luego escribías otra clienta, el cobro se ligaba a la cita equivocada y le descontaba un anticipo ajeno. Ahora el vínculo se suelta al cambiar el nombre o la fecha.
- **C9** Un error del servidor en HTML (502, 504) ya no truena la app: muestra un mensaje claro.
- **C10** La trabajadora en un salón sin catálogo veía "Ir a Configuración" y el botón la regresaba al Inicio. Ahora ve "Pídele a la dueña que los agregue".
- **C11** Borrar vacaciones o un día libre ahora pide confirmación, como el resto de la Agenda.

### Agregado
- **C14** Sección "Sin cerrar" en la Agenda (dueña): citas de días pasados que siguen pendientes, con "Registrar cobro", "No asistió" o "Cancelar". El menú de una cita pendiente de hoy o de un día pasado también ofrece "Registrar cobro".
- Registrar Cita acepta abrirse en un día específico (`#cita?fecha=`).
- Pruebas de integración de la API contra un Postgres real en proceso (PGlite, dependencia de desarrollo): 17 nuevas, más la del validador de uuid. 38 en total.

### Seguridad
- **C8** Quitarle el acceso a una trabajadora o borrarla de Configuración borra también su Face ID / Touch ID, y el login con Face ID revisa que ella siga con acceso.
- **C5** `crear-salon --plantilla` ya no copia los PINs de las trabajadoras.
- **C6** `crear-salon --pin` rechaza un PIN que ya usa otra persona. El chequeo es uno solo (`pinEnUso()`) y además corrige dos detalles del anterior en `trabajador-pin`: ya compara bien los PINs legacy y ya no ignora a una trabajadora de otro salón con el mismo nombre.
- **C12** El cron diario borra los intentos de login de más de 30 días.
- `agenda_id` se valida como uuid (antes un id mal formado daba 500).

### Base de datos
- **C13** `scripts/migrations/000_base.sql`: las tablas base exportadas de la base real. Con `000` a `007` se levanta la base desde cero. No hace falta aplicarla en producción (todo es `if not exists`).

### Docs
- Documentación completa del proyecto en `docs/`: PRD, arquitectura, design system, base de datos, guía de API, estilo de código, seguridad, pruebas, manejo de errores, deployment y AppFlow (Markdown y HTML visual).
- README reescrito como punto de entrada, con enlaces a cada documento.
- `CLAUDE.md`: regla para mantener los docs y este CHANGELOG al día en cada cambio.
- `.env.example`: se agregan las variables de push (`VAPID_*`) y `CRON_SECRET`.
- AppFlow documenta 14 cabos sueltos detectados al mapear los flujos (sin cambios de código todavía).
- `docs/AppFlow.html` rehecho como tablero interactivo tipo Miro: lienzo con zoom y arrastre, marcos por flujo con diagramas conectados, minimapa, búsqueda, filtro por rol y cabos sueltos como notas adhesivas enlazadas a su paso.
- `CLAUDE.md`: se define cómo debe ser `AppFlow.html` para que las próximas versiones sigan el mismo formato.
- AppFlow (MD y tablero) marca los 14 cabos sueltos como resueltos y refleja los flujos nuevos. PRD, API, base de datos, seguridad, manejo de errores, pruebas, estilo y design system actualizados.

## v45 · 2026-09-26

### Agregado
- Trabajadora: "Actualizar app" y versión instalada al pie de su inicio.
- Configuración: confirmar antes de eliminar un servicio, producto o trabajadora.
- Configuración: Servicios y Productos se contraen y despliegan.
- Agenda: confirmación antes de cancelar, marcar "No asistió" o eliminar. Se puede volver a pendiente.
- Agenda: hora en formato AM/PM.
- WhatsApp: el mensaje de confirmación saluda a la clienta por su primer nombre.
- Configuración: versión instalada y enlace discreto "Actualizar app".
- La app se actualiza sola al publicar una versión nueva (al cambiar de pantalla).
- Agenda: agregar o cambiar el teléfono de la clienta desde el menú de la cita. Nuevo texto del mensaje de WhatsApp.

## v39 · 2026-09-22

### Agregado
- Agendar Cita: se muestra el día de la semana junto a la fecha.

### Corregido
- Agendar Cita respeta el día elegido en la vista Mes.
- Toda la app se cargaba dos veces y cada llamada a la API se duplicaba (el `?v=` en `app.js`).

## v38 · 2026-09-21

### Agregado
- Face ID / Touch ID para entrar sin PIN (WebAuthn).
- Accesos rápidos para marcar vacaciones y días libres en la Agenda.
- Registrar Cita y Agendar Cita capturan y prellenan el teléfono de la clienta.

### Cambiado
- El teléfono de la clienta se captura al agendar, no al cobrar.
- Selector de hora simplificado: 1 a 12, minutos de 10 en 10, AM/PM.
- Comisiones abre por default de lunes a domingo de la semana actual.
- Logo real en el inicio de la dueña y de la trabajadora. Monograma cuadrado como ícono de inicio.
- Los endpoints de WebAuthn se fusionaron en uno solo (límite de 12 funciones de Vercel).

### Corregido
- El zoom de Safari al teclear el PIN rápido.
- El teléfono de una clienta se quedaba pegado al cambiar el nombre.

### Seguridad
- La trabajadora ya no ve el teléfono de ninguna clienta, ni siquiera al capturar una nueva.

### Base de datos
- `006_webauthn.sql`: tabla `webauthn_credentials`.
- `007_ausencias.sql`: tabla `ausencias`.

## v27 · 2026-09-20

### Agregado
- Notificaciones push: recordatorio diario de citas de mañana y aviso cuando una trabajadora registra una cita.
- Confirmar cita por WhatsApp y compartir recibo por WhatsApp o iMessage.
- Teléfono de la clienta en su ficha.
- Guía "Agregar a inicio" para iOS / Safari.
- Splash screen de iOS para la app instalada.
- Diseño de dos columnas en iPad.

### Cambiado
- Nueva identidad visual: negro y rosa tomados del logo real, con contraste WCAG AA.
- Branding genérico reemplazado por el logo del salón.
- La app respeta el notch, la Dynamic Island y la barra de gestos del iPhone.

### Base de datos
- `004_clienta_telefono.sql`: `clientas.telefono`.
- `005_push_subscriptions.sql`: tabla `push_subscriptions`.

## v19 · 2026-09-14

### Agregado
- Rol de trabajadora con acceso limitado y PIN propio.
- Toques de interacción: check animado al confirmar, loaders con spinner y rebote al tocar.

### Cambiado
- Inicio rediseñado: más limpio, sin "Próximas citas" y con el bloque "Más" colapsable.

### Corregido
- La trabajadora veía toda la app porque el login no guardaba su rol.
- El botón "Dar acceso a la app" no hacía nada en Configuración.
- Eliminar una cita agendada ahora elimina también su anticipo (quedaba un ingreso huérfano).

## v16 · 2026-09-13

### Agregado
- Agenda con anticipos: agendar citas futuras y cobrarlas desde Registrar Cita.
- Reagendar una cita desde la Agenda.
- Dashboard de tendencias con selector de mes.
- Comisiones de la semana por trabajadora en el inicio.
- "Deshacer" al eliminar citas y gastos.
- Primeras pruebas automatizadas (`auth`, `validate`, paridad de `normalizeNombre`).

### Cambiado
- El resumen del inicio pasó de diario a semanal.
- El recuadro de citas agendadas en Registrar Cita sigue la fecha elegida.

### Corregido
- Doble registro por doble tap en "Confirmar".
- Eliminar una cita ahora elimina también sus comisiones.
- Error 400 con PIN por caché `immutable` de JS/CSS.

### Seguridad
- Cada endpoint exige un token firmado y usa solo el salón del token.
- PIN con pepper del servidor (HMAC-SHA256) y rate limit de login por IP.
- Borrado lógico en citas y gastos.
- Se cerró un XSS en textos libres.

### Base de datos
- `001_security_hardening.sql`: `pin_hash_v2`, `deleted_at`, `login_attempts`.
- `002_agenda.sql`: `citas_agendadas`, `citas.agenda_id`, `citas.anticipo_aplicado`.
- `003_comisiones_soft_delete.sql`: `comisiones.deleted_at`.

## v13 · 2026-09-12

### Agregado
- Primera versión en producción: login por PIN, registrar cita (servicios, productos, precios, comisiones, notas, pago), registrar gasto, registros del día, historial de clientas con nota fija, comisiones y configuración del catálogo.
- Script `crear-salon` para dar de alta salones.
