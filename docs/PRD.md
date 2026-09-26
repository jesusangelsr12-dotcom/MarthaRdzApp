# PRD · Martha Rdz Hair Artist

**Última revisión:** 2026-09-26 · **Versión de la app:** v47 (`CACHE_NAME` en `public/sw.js`)

## 1. El problema

Un salón chico lleva su operación en libretas, notas del celular y mensajes
de WhatsApp. Eso causa cuatro dolores concretos:

1. **No sabe cuánto ganó.** Ingresos, gastos y comisiones viven en lugares
   distintos y nadie los suma hasta fin de mes (si acaso).
2. **Las comisiones se pelean.** El porcentaje cambia por servicio y por
   trabajadora, y el cálculo a mano se presta a errores.
3. **Se pierden las fórmulas.** El tinte que se usó con una clienta, o su
   alergia, se olvidan entre visitas.
4. **Las citas se caen.** Sin confirmación previa, la clienta no llega y el
   anticipo (si lo hubo) no queda registrado en ningún lado.

## 2. Para quién

| Persona | Qué necesita | Cómo usa la app |
|---|---|---|
| **Dueña del salón** | Control total del dinero y de la operación | En su celular, varias veces al día. A veces en iPad. |
| **Trabajadora** (estilista) | Registrar lo que cobra y ver su agenda, sin acceso al dinero del salón | En su propio celular, con su PIN |
| **Clienta** | Recibir confirmación de su cita y su recibo | No usa la app. Recibe mensajes por WhatsApp o iMessage. |
| **Administrador técnico** (JR Consulting) | Dar de alta salones y desplegar cambios | Scripts y Vercel |

## 3. Objetivos

- Registrar una cita completa en menos de un minuto, con el pulgar y sin teclado cuando se pueda.
- Que la dueña vea cómo va la semana apenas abre la app.
- Que ninguna trabajadora vea dinero agregado ni datos personales de clientas.
- Que borrar algo por error siempre se pueda deshacer.
- Que funcione como app instalada en iPhone (pantalla completa, ícono propio, sin barra de Safari).

### Fuera de alcance (por ahora)

- Enviar WhatsApp automático sin que alguien toque "Enviar". Requiere la
  WhatsApp Business Platform; es un proyecto aparte (ver `public/js/whatsapp.js`).
- Alta de salones desde la app (se hace con `scripts/crear-salon.js`).
- Inventario de productos, facturación (CFDI) y pagos en línea.
- Uso sin conexión para capturar datos (solo carga la interfaz sin red).

## 4. Roles y permisos

La regla viva está en [CLAUDE.md](../CLAUDE.md). Resumen:

| Capacidad | Dueña | Trabajadora |
|---|:---:|:---:|
| Entrar con PIN o Face ID / Touch ID | ✅ | ✅ (Face ID solo por API, no hay botón en su UI) |
| Ver agenda (citas y ausencias) | ✅ | ✅ |
| Agendar cita (con anticipo) | ✅ | ✅ |
| Registrar / cobrar cita | ✅ | ✅ |
| Asignar comisión | A cualquier trabajadora | Solo a sí misma |
| Ver teléfono y nota fija de clientas | ✅ | ❌ |
| Reagendar, cambiar estado, editar nota o eliminar cita agendada | ✅ | ❌ |
| Marcar vacaciones / días libres | ✅ | ❌ |
| Registrar gasto | ✅ | ❌ |
| Ver Registros, Comisiones, Dashboard, resumen semanal | ✅ | ❌ |
| Historial de clientas | ✅ | ❌ |
| Configuración (catálogo, trabajadoras, PINs, push, Face ID) | ✅ | ❌ |
| Recibir notificaciones push | ✅ | ❌ |
| "Actualizar app" | En Configuración | En su inicio |

Pantallas de la trabajadora: `login`, `home`, `agenda`, `agendar`, `cita`.

## 5. Funcionalidades

Cada funcionalidad tiene un **criterio de aceptación**. Si no se cumple, no
está terminada.

### F1 · Acceso

- PIN de 6 dígitos con teclado numérico propio. Al teclear el sexto dígito se envía solo.
- El backend descubre a qué salón (y a qué persona) pertenece el PIN. No hay selector de salón.
- Tras 5 intentos fallidos en 15 minutos desde la misma IP, se bloquea el acceso.
- Face ID / Touch ID opcional, se activa desde Configuración después de entrar con PIN.
- La sesión dura 8 horas. Al vencer, la siguiente acción regresa a Login con el aviso "Tu sesión expiró".

**Criterio:** un PIN correcto lleva al inicio correcto según el rol. Uno
incorrecto sacude los puntos y los limpia. El sexto error seguido muestra
"Demasiados intentos".

### F2 · Inicio

- **Dueña:** logo, resumen de la semana (lunes a domingo: ingresos, citas,
  gastos y comisiones por trabajadora), 4 acciones principales (Agenda,
  Registrar Cita, Registrar Gasto, Clientas) y un bloque "Más" colapsado
  (Registros, Comisiones, Dashboard, Configuración).
- **Trabajadora:** logo, Agenda, Registrar Cita, cerrar sesión y "Actualizar app".
- En iOS con Safari (no instalada) aparece un aviso para "Agregar a inicio".

### F3 · Registrar Cita (wizard)

Pasos dinámicos. Solo aparecen los que aplican al salón:

1. **Clienta y fecha.** Autocompleta con clientas previas. Muestra recuadros
   de citas agendadas pendientes para esa fecha; tocar uno llena el nombre y
   salta al siguiente paso.
2. **Servicios** (si el salón tiene catálogo). Multiselección.
3. **Productos** (si el salón tiene catálogo). Multiselección.
4. **Precio** de cada item, uno por uno, con teclado numérico.
5. **Comisiones** (si hay trabajadoras). Trabajadora + % por item. La app calcula el monto.
6. **Fórmula o notas.** Muestra la nota fija de la clienta (alergias) si existe.
7. **Método de pago:** Efectivo, Tarjeta o Transferencia.
8. **Confirmar** con desglose, comisiones y total.

**Reglas:**
- Debe haber al menos un servicio o un producto.
- Si la cita viene de una agendada con anticipo, se cobra hoy `total − anticipo` (nunca menos de cero). La comisión se calcula sobre el precio completo.
- Una cita agendada solo se puede cobrar una vez (candado en el servidor).
- Doble tap en "Confirmar" no duplica el registro.

### F4 · Agenda

- Vista **Agenda**: próximos 60 días agrupados por fecha.
- **Sin cerrar** (dueña): arriba de la vista Agenda, las citas de días pasados que siguen pendientes, para que ninguna se pierda de vista con su anticipo.
- Vista **Mes**: calendario con punto en días con citas y color en días con ausencias.
- Menú por cita (dueña): registrar cobro (si es de hoy o de un día pasado),
  confirmar por WhatsApp, agregar/cambiar teléfono, editar nota, reagendar,
  "No asistió", cancelar, volver a pendiente y eliminar.
- Mensaje de confirmación por WhatsApp (se puede editar antes de enviar):
  "Hola! Te escribo de Martha Rdz Hair Artist para confirmar tu próxima cita
  el día viernes 9 de octubre a las 4:30 PM. ¿Confirmas tu cita? Gracias!"
- Cancelar, "No asistió", eliminar y borrar vacaciones piden confirmación y ofrecen "Deshacer".
- Una cita **ya cobrada** no se elimina desde la Agenda: su cobro se corrige en Ver Registros.
- Botón "+": agendar cita o marcar vacaciones / día libre (dueña o una trabajadora).

**Estados de una cita agendada:** `pendiente → completada` (solo al cobrarla),
`pendiente ↔ cancelada`, `pendiente ↔ no_asistio`. Una completada ya no se edita.

### F5 · Agendar Cita (wizard)

Clienta + teléfono (solo dueña) + fecha + hora (selector 12 h, minutos de 10
en 10) → anticipo → método de pago del anticipo (si hubo) → nota → confirmar.

**Regla clave:** el anticipo se registra como ingreso **del día en que se recibe**
(fecha de Ciudad de México), no del día de la cita.

### F6 · Registrar Gasto (solo dueña)

Descripción → monto → método de pago → confirmar. La fecha siempre es hoy.

### F7 · Registros del día (solo dueña)

- Selector de fecha (hasta hoy). Totales de ingresos y gastos.
- Cada cita muestra desglose, anticipo aplicado y su fórmula editable.
- Compartir recibo por la hoja nativa de compartir (WhatsApp, iMessage…).
- Eliminar con confirmación y "Deshacer" (borrado lógico). Borrar una cita borra sus comisiones.

### F8 · Clientas (solo dueña)

Buscador instantáneo (sin llamadas por tecla). Por clienta: visitas, total
gastado, última visita, fórmula más reciente, nota fija y teléfono editables.

### F9 · Comisiones (solo dueña)

Rango de fechas (default: lunes a domingo de esta semana). Total general y
tarjeta por trabajadora con separación servicios / productos y detalle.

### F10 · Dashboard (solo dueña)

Mes seleccionable (nunca futuro). Ingresos, gastos, comisiones, ganancia
neta, gráfica diaria y top 5 de servicios, productos y clientas.

**Fórmula:** `ganancia neta = ingresos − gastos − comisiones`. Los anticipos
cuentan como ingreso, pero no como cita.

### F11 · Configuración (solo dueña)

Catálogo de servicios y productos (secciones colapsables), trabajadoras,
dar / cambiar / quitar PIN de trabajadora, notificaciones push, Face ID /
Touch ID por dispositivo, versión instalada y "Actualizar app". Borrar algo
pide confirmación y se aplica al tocar "Guardar Cambios".

### F12 · Notificaciones push (solo dueña)

- Todos los días a las 18:00 (hora de Ciudad de México): "Tienes N citas mañana".
- Cada vez que una trabajadora registra una cita: nombre, clienta y monto.
- En iPhone solo funcionan con la app instalada en pantalla de inicio (iOS 16.4+).

### F13 · Actualización automática

Cada deploy cambia `CACHE_NAME`. La app detecta la versión nueva al volver
al frente y se recarga sola **al cambiar de pantalla**, nunca a media captura.

## 6. Métricas de éxito

No hay analítica instalada. Estas son las señales que hoy se pueden medir
con la base de datos:

| Señal | Cómo se mide |
|---|---|
| La app se usa a diario | Días con al menos una fila en `citas` |
| Menos citas perdidas | % de `citas_agendadas` en `no_asistio` por mes |
| Las trabajadoras la adoptan | Citas registradas con token de trabajadora (hoy solo visible por el push) |
| Errores de captura | Filas con `deleted_at` en `citas` y `gastos` |

## 7. Supuestos y restricciones

- Todos los salones están en México (teléfonos de 10 dígitos, prefijo 52, zona horaria de Ciudad de México, pesos MXN).
- Vercel Hobby: máximo 12 serverless functions por deploy. **Hoy se usan las 12.**
- Sin paso de build: lo que está en `public/` es lo que se sirve.
- El nombre de la clienta es texto libre. Se agrupa por nombre normalizado (sin acentos ni mayúsculas).

## 8. Pendientes conocidos

Ver la sección "Cabos sueltos" de [AppFlow.md](AppFlow.md). Es la lista
viva de lo que falta resolver. Los 14 primeros se resolvieron en la v46.
