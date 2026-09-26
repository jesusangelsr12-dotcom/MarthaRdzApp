# Martha Rdz Hair Artist — notas para cambios

## Cuenta de trabajadora: todo cambio aplica también a ella

Cada cambio en la app se revisa también para la cuenta de trabajadora
(`isTrabajadora()` en `public/js/auth.js`): si le sirve y no toca información
confidencial, se le aplica igual que a la dueña.

Lo que una trabajadora **nunca** debe ver ni hacer:

- Detalle de clientas: nota fija (alergias/preferencias) e historial
  (`api/clientas.js` ya se los omite). El teléfono tampoco, **salvo** que la
  dueña le prenda el permiso "Teléfonos de clientas" en Configuración: ahí
  puede ver y agregar teléfonos en la Agenda y en Agendar, y confirmar por
  WhatsApp. El servidor lo revisa en cada llamada (`permisosDeTrabajadora`
  en `lib/auth.js`) y aun con permiso nunca le deja tocar la nota fija.

Permisos extra de una trabajadora: viven en `salones.trabajadoras[].permisos`,
todos apagados por default. Uno nuevo se agrega a `PERMISOS_TRABAJADORA`
(`lib/auth.js`) y a `PERMISOS` (`public/js/views/config.js`).
- Dinero agregado del salón: resumen, dashboard, registros, gastos y
  comisiones.
- Configuración (servicios, productos, trabajadoras, PINs).
- Cambiar estado, reagendar, editar nota o eliminar citas agendadas, y todo lo
  de ausencias/vacaciones (el backend lo bloquea; el front no le muestra
  esos botones).

Pantallas a las que sí entra: `login`, `home`, `agenda`, `agendar`, `cita`
(`RUTAS_TRABAJADORA` en `public/js/app.js`). Si algo nuevo vive en una
pantalla a la que ella no entra y sí le sirve (ej. "Actualizar app"), va
también en su inicio (`renderTrabajadora` en `public/js/views/home.js`).

## Cada deploy

Subir `CACHE_NAME` en `public/sw.js` para que los celulares tomen la versión
nueva. Un archivo JS nuevo se agrega también a `STATIC_ASSETS`.

## Documentación: se actualiza en cada cambio

Los docs viven en `README.md`, `CHANGELOG.md` y `docs/`. No se escriben una
vez y se olvidan: cada cambio actualiza los que toca, en el mismo commit.

| Si el cambio… | Actualiza |
|---|---|
| Llega a producción (siempre) | `CHANGELOG.md` (sección "Sin publicar" o la versión nueva) |
| Agrega o cambia una funcionalidad o un permiso | `docs/PRD.md` |
| Agrega un endpoint, archivo o dependencia | `docs/Architecture.md`, `docs/API-Guide.md` |
| Toca colores, componentes o reglas de UI | `docs/Design-System.md` |
| Agrega una migración o cambia una regla de datos | `docs/Database.md` |
| Toca auth, permisos, secretos o headers | `docs/Security.md` |
| Agrega pruebas o cambia qué es "terminado" | `docs/Testing.md` |
| Cambia cómo se manejan o muestran errores | `docs/Error-Handling.md` |
| Agrega una variable de entorno o cambia el deploy | `docs/Deployment.md`, `.env.example` |
| Cambia un flujo o resuelve un cabo suelto | `docs/AppFlow.md` **y** `docs/AppFlow.html` (mismos datos) |

Al resolver un cabo suelto (C1, C2…), márcalo como resuelto en AppFlow y
anótalo en el CHANGELOG.

### Cómo debe ser `docs/AppFlow.html`

No es una página para leer de arriba abajo: es un **tablero interactivo
estilo Miro** con los mismos flujos de `docs/AppFlow.md`.

- Lienzo infinito con cuadrícula de puntos. Se arrastra para moverse y se
  hace zoom con rueda, pellizco o botones (+, −, 100 %, "Ver todo").
- Un marco por flujo (F0…F13), agrupados por tema, más un marco del mapa
  del dinero y otro de cabos sueltos como notas adhesivas.
- Cada flujo es un diagrama real: nodos por tipo (pantalla, acción,
  endpoint, tabla, servicio externo, decisión, fin bien/error) unidos con
  flechas y etiquetas Sí/No en cada rama.
- Minimapa, panel con índice, búsqueda y filtro por rol (Todos, Dueña,
  Trabajadora), y enlaces de ida y vuelta entre cada cabo suelto y el paso
  donde ocurre.
- Un solo archivo, sin librerías externas (solo la fuente Inter). Los datos
  viven en los arreglos `FLOWS`, `ISSUES`, `MONEY` y `STATES` al inicio del
  script. Para cambiar el tablero se editan esos datos, no el HTML.
- Antes de entregarlo: abrirlo en escritorio y en celular, revisar que
  ningún nodo se encime y que "Ver todo" deje el tablero legible.
