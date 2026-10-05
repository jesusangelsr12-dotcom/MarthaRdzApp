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
| Fechas | `YYYY-MM-DD`. `timestamp` de citas y gastos `HH:MM:SS`. Cuando el servidor fecha algo por su cuenta usa la fecha de Ciudad de México (`lib/fecha.js`), nunca la de UTC |
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
| 409 | PIN de trabajadora ya en uso. Anticipo de la Agenda que ya se aplicó a otra cita |
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
| `GET` | 👑 | `?fecha=YYYY-MM-DD` | `{citas:[{fecha, timestamp, clienta, items, total, metodo_pago, nota, anticipo, anticipo_aplicado}]}` |
| `GET` anticipos | 👤 | `?anticipos=pendientes` | `{anticipos:[{id, clienta, fecha, monto}]}`: anticipos de la Agenda vieja que todavía no se aplican. Otro valor: `400` |
| `POST` | 👤 | Ver abajo | `201 {success}` |
| `PATCH` nota | 👑 | `{fecha, timestamp, clienta, nota}` | `{success}` |
| `PATCH` restaurar | 👑 | `{fecha, timestamp, clienta, restore:true}` | `{success}` (restaura también sus comisiones y vuelve a aplicar su anticipo de la Agenda). `409` si ese anticipo ya se aplicó a otra cita |
| `DELETE` | 👑 | `{fecha, timestamp, clienta}` | `{success}` (borra también sus comisiones; su anticipo de la Agenda, si tenía, regresa a pendiente) |

```json
// POST /api/citas
{
  "fecha": "2026-09-26", "timestamp": "14:30:05", "clienta": "María López",
  "items": [
    { "tipo": "servicio", "nombre": "Tinte", "costo": 800 },
    { "tipo": "producto", "nombre": "Shampoo", "costo": 250 }
  ],
  "total": 1050,
  "metodo_pago": "Tarjeta",
  "nota": "Tinte 7.1 + 20 vol, 35 min",
  "comisiones": [
    { "trabajadora": "Aly", "item": "Tinte", "tipo": "servicio", "costo": 800, "pct": 40, "comision": 320 }
  ],
  "anticipo": 250,                  // opcional (default 0), va DENTRO de total
  "anticipo_origen_id": "<uuid>"    // opcional: anticipo de la Agenda que se aplica
}
```

**Reglas:**
- `items` no vacío. `tipo` ∈ {servicio, producto}. `costo` 0 a 1,000,000.
- `total` 0 a 10,000,000. `pct` 0 a 100.
- `anticipo` 0 a `total`: es la parte del total que ya estaba pagada. **No se resta**: `total` es el precio completo, cuenta entero en ingresos el día de la cita y las comisiones salen del precio completo. Mayor que `total`: `400`. La base también lo impide (`citas_anticipo_valido`).
- `anticipo_origen_id` (uuid, si no `400`) exige `anticipo > 0`. Oculta (`deleted_at`) esa fila de anticipo de la Agenda solo si sigue viva, es del salón y su monto es igual a `anticipo`. Si no, `409 Ese anticipo ya se aplicó a otra cita o ya no existe` y no se guarda nada.
- Ocultar el anticipo viejo, insertar la cita e insertar sus comisiones es **una sola sentencia**: si algo falla, no se guarda nada y se puede reintentar.
- Trabajadora: cada comisión debe ser suya (`400 Solo puedes asignarte comisión a ti misma`). Además dispara un push a la dueña.

### Clientas: `/api/clientas`

| Método | Permiso | Entrada | Salida |
|---|---|---|---|
| `GET` lista | 👤 | | `{clientas:["Ana", …], notas_fijas:{clave:nota}, telefonos:{clave:tel}}`. Para trabajadora, `notas_fijas` y `telefonos` siempre vienen vacíos |
| `GET` historial | 👑 | `?historial=1` | `{clientas:[{nombre, key, nota_fija, telefono, total_visitas, total_gastado, ultima_visita, visitas:[{fecha, timestamp, clienta_raw, items, total, metodo_pago, nota}]}]}` |
| `POST` | 👑 | `{clienta, nota_fija, telefono}` | `{success}`. Trabajadora: `403` |

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

Todo se agrega en SQL. `ingresos` = suma de `total` de las citas vivas (el anticipo ya va dentro). Los anticipos de la Agenda que siguen pendientes suman a ingresos en su día, pero no a `num_citas` ni al ranking de items.

### Configuración 👑

#### `/api/config`

| Método | Entrada | Salida |
|---|---|---|
| `GET` | | `{salon_nombre, logo_url, servicios, productos, trabajadoras:[{nombre, tiene_acceso, permisos:{}}]}` |
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
| `{nombre, permisos:{<permiso>:true\|false}}` | Prende o apaga un permiso. Responde `{success, permisos}` con todos sus permisos. `400` si trae una llave desconocida o un valor que no es booleano. **Hoy no hay permisos** (`telefonos` se retiró en v50), así que cualquier llave es `400` |

`404` si la trabajadora no está guardada en el catálogo todavía.

#### `/api/push-subscribe`

| Método | Entrada | Salida |
|---|---|---|
| `GET` | | `{public_key}` (VAPID) |
| `POST` | `{subscription:{endpoint, keys:{p256dh, auth}}}` | `{success}` |
| `DELETE` | `{endpoint}` | `{success}` |

### Tareas programadas

#### `GET /api/cron/limpieza`

Lo llama Vercel Cron a las 00:00 UTC (18:00 en Ciudad de México). Si existe
`CRON_SECRET`, exige `Authorization: Bearer $CRON_SECRET`. Borra los
intentos de login de más de 30 días. Responde `{intentos_borrados: N}`.
(Hasta v49 se llamaba `reminder-citas` y además mandaba el recordatorio de
citas de mañana de la Agenda.)

## 3. Servicios externos

| Servicio | Quién lo llama | Detalle |
|---|---|---|
| Neon | Backend | `@neondatabase/serverless`, una request HTTPS por query |
| Web Push (APNs, FCM) | Backend (`lib/push.js`) | Payload `{title, body, url}`. El SW lo muestra y al tocarlo abre `url`. Hoy solo el aviso de cita nueva de una trabajadora |
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
