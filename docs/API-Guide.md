# Guía de API · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Base:** `/api` (mismo dominio que la app)

## 1. Reglas generales

| Tema | Regla |
|---|---|
| Formato | JSON en request y response. `Content-Type: application/json` |
| Autenticación | `Authorization: Bearer <token>`. El token sale de `POST /api/login` o del login con Face ID |
| Salón | **Siempre** el del token. El `sheet_id` que el frontend manda en query o body se ignora (queda por compatibilidad) |
| Rol | En el token: `duena` o `trabajadora`. Un token sin `role` (emitido antes de existir) cuenta como dueña |
| Éxito | `200` lectura o edición, `201` creación. Body `{ success: true, … }` o los datos |
| Error | `{ "error": "Mensaje en español para la usuaria" }` |
| Fechas | `YYYY-MM-DD`. Horas de agenda `HH:MM` (24 h). `timestamp` de citas y gastos `HH:MM:SS`. Cuando el servidor fecha algo por su cuenta usa la fecha de Ciudad de México (`lib/fecha.js`), nunca la de UTC |
| Ids | uuid en texto. Un id mal formado responde 400 |
| Borrado | Lógico. Todo DELETE tiene su restore (PATCH con `restore: true`) |

### Códigos de estado

| Código | Cuándo |
|---|---|
| 400 | Datos faltantes o inválidos, regla de negocio rota |
| 401 | Sin token, token alterado o expirado. PIN incorrecto |
| 403 | Token válido pero de trabajadora en algo de la dueña |
| 404 | El registro a editar o restaurar no existe (o ya estaba en ese estado) |
| 405 | Método no soportado |
| 409 | PIN de trabajadora ya en uso |
| 429 | Demasiados intentos de login |
| 500 | Error del servidor o falta configuración |
| 503 | Sin conexión (lo genera el Service Worker, no el servidor) |

## 2. Endpoints

Leyenda de permisos: 🌐 público · 👤 cualquier sesión · 👑 solo dueña.

### Autenticación

#### `POST /api/login` 🌐

```json
// Request
{ "pin": "123456" }

// 200
{
  "success": true, "token": "<payload>.<firma>",
  "salon_id": "salon_002", "salon_nombre": "Martha Rodriguez Hair Artist",
  "sheet_id": "<uuid del salón>", "logo_url": "",
  "servicios": ["Corte"], "productos": ["Shampoo"],
  "trabajadoras": [{ "nombre": "Aly", "tiene_acceso": true }],
  "role": "duena", "worker_nombre": null
}
```

Busca el PIN en dueñas (`pin_hash_v2`, luego legacy) y después en trabajadoras.
Errores: `400 PIN inválido` · `401 PIN incorrecto` · `429 Demasiados intentos…` (5 fallos / 15 min / IP).

#### `/api/webauthn` (Face ID / Touch ID)

| Llamada | Permiso | Body | Respuesta |
|---|---|---|---|
| `POST` registro, opciones | 👤 | `{mode:'register', action:'options'}` | `{options, challenge_token}` |
| `POST` registro, verificar | 👤 | `{mode:'register', action:'verify', response, challenge_token, device_label}` | `{success}` |
| `POST` login, opciones | 🌐 | `{mode:'login', action:'options'}` | `{options, challenge_token}` |
| `POST` login, verificar | 🌐 | `{mode:'login', action:'verify', response, challenge_token}` | Igual que `/api/login`. Si es de una trabajadora que ya no tiene acceso, borra la credencial y responde `401` |
| `GET` | 👤 | | `{dispositivos:[{id, credential_id, device_label, created_at}]}` de la identidad actual |
| `DELETE` | 👤 | `{id}` | `{success}` |

`challenge_token` es HMAC, dura 5 minutos y en registro va atado a salón, rol y trabajadora.

### Citas cobradas: `/api/citas`

| Método | Permiso | Entrada | Salida |
|---|---|---|---|
| `GET` | 👑 | `?fecha=YYYY-MM-DD` | `{citas:[{fecha, timestamp, clienta, items, total, metodo_pago, nota, anticipo_aplicado, agenda_id, anticipo_agenda}]}` |
| `POST` | 👤 | Ver abajo | `201 {success}` |
| `PATCH` nota | 👑 | `{fecha, timestamp, clienta, nota}` | `{success}` |
| `PATCH` corregir cobro | 👑 | `{fecha, timestamp, clienta, items, metodo_pago}` | `{success, total}` |
| `PATCH` restaurar | 👑 | `{fecha, timestamp, clienta, restore:true}` | `{success}` (restaura también sus comisiones) |
| `DELETE` | 👑 | `{fecha, timestamp, clienta, con_anticipo?}` | `{success, anticipos, agendas}` (borra también sus comisiones; ver abajo si vino de la Agenda) |

```json
// POST /api/citas
{
  "fecha": "2026-09-26", "timestamp": "14:30:05", "clienta": "María López",
  "items": [
    { "tipo": "servicio", "nombre": "Tinte", "costo": 800 },
    { "tipo": "producto", "nombre": "Shampoo", "costo": 250 }
  ],
  "total": 850,
  "metodo_pago": "Tarjeta",
  "nota": "Tinte 7.1 + 20 vol, 35 min",
  "comisiones": [
    { "trabajadora": "Aly", "item": "Tinte", "tipo": "servicio", "costo": 800, "pct": 40, "comision": 320 }
  ],
  "agenda_id": "<uuid>",          // opcional, junto con anticipo_aplicado
  "anticipo_aplicado": 200
}
```

**Reglas:**
- `items` no vacío. `tipo` ∈ {servicio, producto}. `costo` 0 a 1,000,000.
- `total` 0 a 10,000,000. `pct` 0 a 100.
- `agenda_id` y `anticipo_aplicado` van juntos o no van.
- `agenda_id` debe ser un uuid (si no, `400`).
- Con `agenda_id`: marca la cita agendada como `completada` solo si seguía `pendiente`. Si no, `400 Esta cita agendada ya fue registrada o no existe`.
- Marcar la cita agendada, insertar la cita e insertar sus comisiones es **una sola sentencia**: si algo falla, no se guarda nada y se puede reintentar.
- Trabajadora: cada comisión debe ser suya (`400 Solo puedes asignarte comisión a ti misma`). Además dispara un push a la dueña.

**Corregir cobro (`PATCH` con `items`):**
- `items` debe traer **los mismos items** (mismo `tipo` y `nombre`, en el mismo orden): solo cambia `costo`. Si no, `400 Solo se pueden corregir los precios de esta cita`.
- El servidor recalcula `total`. Si la cita vino de una agendada, vuelve a aplicar su anticipo completo (`min(anticipo, suma)`), aunque antes se hubiera topado.
- Sus comisiones (mismo salón, fecha, timestamp, clienta, item y tipo) quedan con `costo` nuevo y `comision = round(costo × pct / 100, 2)`. Cobro y comisiones en **una sola sentencia**.
- Una fila de solo-anticipo responde `400 El anticipo se corrige desde la Agenda`. Dos filas con la misma identidad, `409`.
- `GET` agrega `agenda_id` (`''` si no vino de la Agenda), `anticipo_agenda` (anticipo completo de esa cita agendada, `0` si no hay) y `anticipo_registrado` (lo que de ese anticipo sigue vivo en ingresos): la Agenda los usa para llevar a un cobro, el editor para mostrar el total y "Eliminar" para preguntar si se borra el anticipo.

**Eliminar el cobro de una cita agendada (`DELETE`):**
- Sin `con_anticipo`: la cita agendada vuelve de `completada` a `pendiente` (se puede cobrar de nuevo) y su anticipo se queda.
- `con_anticipo: true`: se borran también sus filas de anticipo y la cita agendada (como "Eliminar" en la Agenda). `con_anticipo` debe ser booleano.
- La fila de un anticipo sola se borra como siempre: no toca la cita agendada.
- Cita, comisiones y lo de la Agenda van en **una sola sentencia** con el mismo `now()`. El restore (`PATCH` con `restore`) regresa lo que se borró en ese mismo momento y vuelve la cita agendada a `completada`. Si mientras tanto se volvió a cobrar o cambió de estado, `409 Esa cita de la Agenda ya cambió; no se puede deshacer`.

### Agenda y ausencias: `/api/citas-agendadas`

Sin `recurso` en el body es una cita agendada. Con `recurso: 'ausencia'` es una ausencia.

| Método | Permiso | Entrada | Salida |
|---|---|---|---|
| `GET` | 👤 | `?fecha=` o `?desde=&hasta=`, opcional `&estado=` | `{citas_agendadas:[{id, clienta, fecha, hora, anticipo, anticipo_metodo_pago, nota, estado}], ausencias:[{id, trabajadora, desde, hasta, nota}]}` |
| `POST` cita | 👤 | `{clienta, fecha, hora, anticipo, anticipo_metodo_pago?, nota?, timestamp}` | `201 {success, id}` |
| `PATCH` editar | 👑 | `{id, estado?, nota?, fecha?, hora?}` | `{success}` |
| `PATCH` anticipo | 👑 | `{id, anticipo, anticipo_metodo_pago?, timestamp?, nota?}` | `{success}` |
| `PATCH` restaurar | 👑 | `{id, restore:true}` | `{success}` (restaura también el anticipo) |
| `DELETE` | 👑 | `{id}` | `{success}` (borra también su anticipo). `400` si ya está `completada` |
| `POST` ausencia | 👑 | `{recurso:'ausencia', trabajadora?, desde, hasta, nota?}` | `201 {success, id}` |
| `PATCH` ausencia | 👑 | `{recurso:'ausencia', id, restore:true}` | `{success}` |
| `DELETE` ausencia | 👑 | `{recurso:'ausencia', id}` | `{success}` |

**Reglas:**
- `anticipo > 0` exige `anticipo_metodo_pago`. `anticipo = 0` lo prohíbe.
- Con anticipo, se crea además una fila en `citas` con la fecha de hoy **en México** y un item `tipo: anticipo`. Todo en una sentencia.
- `DELETE` de una cita `completada` responde `400 Esta cita ya se cobró…`: su cobro se corrige en Ver Registros. En las demás, borra solo la fila del anticipo (nunca un cobro).
- `GET ?hasta=<ayer>&estado=pendiente` (sin `desde`) da las pendientes de días pasados: la sección "Sin cerrar" de la Agenda.
- `PATCH` nunca pone `completada` (eso solo lo hace `POST /api/citas`) y no edita una cita ya completada.
- `PATCH` con `anticipo`: mismas reglas de método que el `POST`; `timestamp` es obligatorio si `anticipo > 0`. En una sola sentencia con la cita agendada:
  - ya tenía fila de anticipo viva → se corrige esa fila (monto, item y método) **en su mismo día**;
  - no tenía (o se borró en Ver Registros) → se crea una con fecha de hoy en México;
  - `anticipo = 0` → su fila se borra (lógico) y se suelta (`agenda_id = null`), para que "Deshacer" de un `DELETE` posterior no la reviva.
  - Cita `completada` → `404` (su anticipo ya se descontó del cobro).
- Ausencia sin `trabajadora` es de la dueña. `hasta >= desde`.

### Clientas: `/api/clientas`

| Método | Permiso | Entrada | Salida |
|---|---|---|---|
| `GET` lista | 👤 | | `{clientas:["Ana", …], notas_fijas:{clave:nota}, telefonos:{clave:tel}, permiso_telefonos}`. Para trabajadora, `notas_fijas` siempre viene vacío y `telefonos` también, salvo que tenga el permiso `telefonos` (`permiso_telefonos: true`) |
| `GET` historial | 👑 | `?historial=1` | `{clientas:[{nombre, key, nota_fija, telefono, total_visitas, total_gastado, ultima_visita, visitas:[{fecha, timestamp, clienta_raw, items, total, metodo_pago, nota}]}]}` |
| `POST` | 👑 · 👤 con permiso | `{clienta, nota_fija, telefono}` | `{success}`. Trabajadora con permiso `telefonos`: solo guarda `telefono` (10 dígitos, obligatorio), ignora `nota_fija`. Sin permiso: `403` |

`clave` = `normalizeNombre(nombre)`. El POST guarda **nota y teléfono juntos**:
manda siempre los dos valores actuales aunque solo cambie uno. `telefono` es
`''` o 10 dígitos.

### Gastos: `/api/gastos` 👑

| Método | Entrada | Salida |
|---|---|---|
| `GET` | `?fecha=` | `{gastos:[{fecha, timestamp, descripcion, monto, metodo_pago}]}` |
| `POST` | `{fecha, timestamp, descripcion, monto, metodo_pago}` | `201 {success}` |
| `PATCH` | `{fecha, timestamp, descripcion, restore:true}` | `{success}` |
| `DELETE` | `{fecha, timestamp, descripcion}` | `{success}` |

### Reportes 👑

#### `GET /api/comisiones?desde=&hasta=`

`{comisiones:[{fecha, timestamp, clienta, trabajadora, item, tipo, costo, pct, comision}]}`.
Sin fechas devuelve todo el historial.

#### `GET /api/dashboard?desde=&hasta=`

```json
{
  "resumen": { "ingresos": 0, "gastos": 0, "comisiones": 0, "utilidad_neta": 0, "num_citas": 0, "num_gastos": 0 },
  "serie_diaria": [{ "fecha": "2026-09-01", "ingresos": 0, "gastos": 0 }],
  "top_servicios": [{ "nombre": "", "cantidad": 0, "total": 0 }],
  "top_productos": [{ "nombre": "", "cantidad": 0, "total": 0 }],
  "top_clientas":  [{ "nombre": "", "visitas": 0, "total": 0 }]
}
```

Todo se agrega en SQL. Los anticipos suman a ingresos pero no a `num_citas` ni al ranking de items.

### Configuración 👑

#### `/api/config`

| Método | Entrada | Salida |
|---|---|---|
| `GET` | | `{salon_nombre, logo_url, servicios, productos, trabajadoras:[{nombre, tiene_acceso, permisos:{telefonos}}]}` |
| `POST` | `{servicios:[…], productos:[…], trabajadoras:[{nombre}]}` | `{success}` |

Reemplaza los arreglos completos (máx. 300 elementos cada uno). De cada
trabajadora solo toma el `nombre`; conserva su `pin_hash` y sus `permisos` si
sigue en la lista con el mismo nombre. Las
trabajadoras que salen de la lista pierden también sus credenciales de Face ID.

#### `POST /api/trabajador-pin`

| Body | Efecto |
|---|---|
| `{nombre, pin}` | Da o cambia el PIN. `409` si ya lo usa otra persona en cualquier salón (dueña con hash nuevo o legacy, o trabajadora) |
| `{nombre, remove:true}` | Quita el acceso (conserva el nombre) y borra sus credenciales de Face ID |
| `{nombre, permisos:{telefonos:true\|false}}` | Prende o apaga un permiso. Responde `{success, permisos}` con todos sus permisos. `400` si trae una llave desconocida o un valor que no es booleano |

`404` si la trabajadora no está guardada en el catálogo todavía.

#### `/api/push-subscribe`

| Método | Entrada | Salida |
|---|---|---|
| `GET` | | `{public_key}` (VAPID) |
| `POST` | `{subscription:{endpoint, keys:{p256dh, auth}}}` | `{success}` |
| `DELETE` | `{endpoint}` | `{success}` |

### Tareas programadas

#### `GET /api/cron/reminder-citas`

Lo llama Vercel Cron a las 00:00 UTC (18:00 en Ciudad de México). Si existe
`CRON_SECRET`, exige `Authorization: Bearer $CRON_SECRET`. Además borra los
intentos de login de más de 30 días. Responde
`{salones_notificados: N, intentos_borrados: M}`.

## 3. Servicios externos

| Servicio | Quién lo llama | Detalle |
|---|---|---|
| Neon | Backend | `@neondatabase/serverless`, una request HTTPS por query |
| Web Push (APNs, FCM) | Backend (`lib/push.js`) | Payload `{title, body, url}`. El SW lo muestra y al tocarlo abre `url` |
| WebAuthn | Navegador + `@simplewebauthn/server` | RP ID = host del request. Cambiar de dominio invalida las credenciales |
| WhatsApp | Navegador | `https://wa.me/52<10 dígitos>?text=<mensaje>`. Abre el chat, la persona toca Enviar |
| Hoja de compartir | Navegador | `navigator.share({text})`. En desktop cae a `wa.me` |

## 4. Cliente del frontend

Todas las llamadas pasan por `fetchAPI()` en `public/js/api.js`:

```js
const data = await fetchAPI('citas', { method: 'POST', body: { … } });
// Lanza Error(data.error) si response.ok es falso.
```

- **401 con token** (sesión vencida o inválida): borra la sesión, muestra "Tu sesión expiró" y manda a `#login`. Un 401 sin token (PIN incorrecto) se deja pasar a la vista.
- **Respuesta que no es JSON** (ej. un 502 de Vercel en HTML): no truena; lanza un mensaje según el código.

Para agregar un endpoint:
1. Función nombrada en `api.js` (verbo + recurso: `getX`, `createX`, `updateX`, `deleteX`, `restoreX`).
2. Handler en `api/` con el patrón de [Architecture.md §4.3](Architecture.md#43-anatomía-de-un-handler).
3. Revisa el límite de 12 funciones antes de crear un archivo nuevo en `api/`.
4. Documenta el endpoint aquí.
