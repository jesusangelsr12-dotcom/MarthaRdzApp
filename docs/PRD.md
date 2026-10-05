# PRD · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Versión de la app:** v50 (`CACHE_NAME` en `public/sw.js`)

## 1. El problema

Un salón chico lleva su operación en libretas, notas del celular y mensajes
de WhatsApp. Eso causa cuatro dolores concretos:

1. **No sabe cuánto ganó.** Ingresos, gastos y comisiones viven en lugares
   distintos y nadie los suma hasta fin de mes (si acaso).
2. **Las comisiones se pelean.** El porcentaje cambia por servicio y por
   trabajadora, y el cálculo a mano se presta a errores.
3. **Se pierden las fórmulas.** El tinte que se usó con una clienta, o su
   alergia, se olvidan entre visitas.
4. **Los anticipos se pierden.** La clienta deja un anticipo y, si nadie lo
   apunta junto con su cita, no queda claro cuánto se cobró en total.

## 2. Para quién

| Persona | Qué necesita | Cómo usa la app |
|---|---|---|
| **Dueña del salón** | Control total del dinero y de la operación | En su celular, varias veces al día. A veces en iPad. |
| **Trabajadora** (estilista) | Registrar lo que cobra, sin acceso al dinero del salón | En su propio celular, con su PIN |
| **Clienta** | Recibir su recibo | No usa la app. Lo recibe por WhatsApp o iMessage. |
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
| Registrar cita (con anticipo) | ✅ | ✅ |
| Aplicar un anticipo que dejó la Agenda | ✅ | ✅ |
| Asignar comisión | A cualquier trabajadora | Solo a sí misma |
| Ver y editar teléfono de clientas | ✅ | ❌ |
| Ver nota fija (alergias) de clientas | ✅ | ❌ |
| Editar nota o eliminar una cita ya registrada | ✅ | ❌ |
| Registrar gasto | ✅ | ❌ |
| Ver Registros, Comisiones, Dashboard, resumen semanal | ✅ | ❌ |
| Historial de clientas | ✅ | ❌ |
| Configuración (catálogo, trabajadoras, PINs, push, Face ID) | ✅ | ❌ |
| Recibir notificaciones push | ✅ | ❌ |
| "Actualizar app" | En Configuración | En su inicio |

Pantallas de la trabajadora: `login`, `home`, `cita`.

**Permisos por trabajadora.** El mecanismo existe (interruptores "Puede
usar" en Configuración, que valen al momento sin cerrar sesión), pero hoy no
hay ningún permiso: **Teléfonos de clientas** se retiró con la Agenda en la
v50 porque solo servía ahí. Con ningún permiso, Configuración no muestra la
sección "Puede usar".

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
  gastos y comisiones por trabajadora), 3 acciones principales (Registrar
  Cita, Registrar Gasto, Clientas) y un bloque "Más" colapsado
  (Registros, Comisiones, Dashboard, Configuración).
- **Trabajadora:** logo, Registrar Cita, cerrar sesión y "Actualizar app".
- En iOS con Safari (no instalada) aparece un aviso para "Agregar a inicio".

### F3 · Registrar Cita (wizard)

Pasos dinámicos. Solo aparecen los que aplican al salón:

1. **Clienta y fecha.** Autocompleta con clientas previas. Si la clienta
   tiene un anticipo que dejó la Agenda, avisa "Ya tiene anticipo" con su
   monto y fecha.
2. **Servicios** (si el salón tiene catálogo). Multiselección.
3. **Productos** (si el salón tiene catálogo). Multiselección.
4. **Precio** de cada item, uno por uno, con teclado numérico.
5. **Comisiones** (si hay trabajadoras). Trabajadora + % por item. La app calcula el monto.
6. **Fórmula o notas.** Muestra la nota fija de la clienta (alergias) si existe.
7. **¿Dejó anticipo?** Teclado con el monto, o el botón **Sin anticipo**. Si
   la clienta tiene un anticipo de la Agenda, aparece en una tarjeta para
   aplicarlo con un toque.
8. **Método de pago:** Efectivo, Tarjeta o Transferencia (uno por cita).
9. **Confirmar** con desglose, total, anticipo, "Resta por cobrar" y comisiones.

**Reglas:**
- Debe haber al menos un servicio o un producto.
- **El anticipo va dentro del total.** Una cita de $2,500 con $500 de
  anticipo se registra con total $2,500. Los $2,500 cuentan en ingresos el
  día de la cita y las comisiones salen sobre el precio completo. El
  anticipo solo informa cuánto ya estaba pagado.
- El anticipo no puede ser mayor que el total (lo revisan la app, el servidor y la base).
- **Anticipos de la Agenda.** Los que la Agenda registró como ingreso de su
  día (hasta v49) y no se han aplicado siguen contando ese día. Al aplicarlo
  a la cita de esa clienta, se mueve al día de la cita (su registro viejo se
  oculta, no se borra) y nunca cuenta dos veces. Solo se puede aplicar una
  vez (candado en el servidor). Si después se elimina la cita, el anticipo
  regresa a su día como pendiente.
- Doble tap en "Confirmar" no duplica el registro.

### F4 · Agenda — retirada en v50

Ya no existe. Las citas se registran solo a mano (F3). La tabla
`citas_agendadas` se queda en la base, sin uso. Los anticipos que la Agenda
dejó registrados se aplican desde F3 (ver "Anticipos de la Agenda").

### F5 · Agendar Cita — retirada en v50

Ya no existe, junto con las vacaciones / días libres y el mensaje de
confirmación por WhatsApp.

### F6 · Registrar Gasto (solo dueña)

Descripción → monto → método de pago → confirmar. La fecha siempre es hoy.

### F7 · Registros del día (solo dueña)

- Selector de fecha (hasta hoy). Totales de ingresos y gastos.
- Cada cita muestra desglose, "Incluye anticipo de $X" (o "Anticipo aplicado" en las cobradas desde la Agenda) y su fórmula editable.
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

**Fórmula:** `ganancia neta = ingresos − gastos − comisiones`. Ingresos es
la suma de los totales (el anticipo ya va dentro). Los anticipos de la Agenda
todavía pendientes cuentan como ingreso en su día, pero no como cita.

### F11 · Configuración (solo dueña)

Catálogo de servicios y productos (secciones colapsables), trabajadoras,
dar / cambiar / quitar PIN de trabajadora, notificaciones push, Face ID /
Touch ID por dispositivo, versión instalada y "Actualizar app". No hay botón
"Guardar": agregar o quitar un servicio, producto o trabajadora se guarda al
momento. Quitar pide confirmación; un servicio o producto quitado se puede
recuperar con "Deshacer" en el aviso. Si no se pudo guardar, avisa y vuelve a
cargar lo que de verdad está guardado.

### F12 · Notificaciones push (solo dueña)

- Cada vez que una trabajadora registra una cita: nombre, clienta y monto.
- (El recordatorio diario "Tienes N citas mañana" se retiró con la Agenda en la v50.)
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
| Anticipos registrados | Citas con `anticipo > 0` por mes |
| Las trabajadoras la adoptan | Citas registradas con token de trabajadora (hoy solo visible por el push) |
| Errores de captura | Filas con `deleted_at` en `citas` y `gastos` |

## 7. Supuestos y restricciones

- Todos los salones están en México (teléfonos de 10 dígitos, prefijo 52, zona horaria de Ciudad de México, pesos MXN).
- Vercel Hobby: máximo 12 serverless functions por deploy. **Hoy se usan 11.**
- Sin paso de build: lo que está en `public/` es lo que se sirve.
- El nombre de la clienta es texto libre. Se agrupa por nombre normalizado (sin acentos ni mayúsculas).

## 8. Pendientes conocidos

Ver la sección "Cabos sueltos" de [AppFlow.md](AppFlow.md). Es la lista
viva de lo que falta resolver. Los 14 primeros se resolvieron en la v46.
