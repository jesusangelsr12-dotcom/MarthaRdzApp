# Seguridad · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05

## 1. Qué protegemos

| Activo | Por qué importa |
|---|---|
| Dinero del salón (ingresos, gastos, comisiones) | Información confidencial de la dueña. Las trabajadoras no deben verla |
| Datos de clientas (teléfono, alergias, historial) | Datos personales. Solo la dueña |
| PINs y credenciales de Face ID | Dan acceso completo al salón |
| Aislamiento entre salones | Un salón nunca debe ver ni tocar datos de otro |
| Secretos del servidor | Quien los tenga puede firmar sesiones válidas |

## 2. Autenticación

### PIN
- 6 dígitos, se teclea en un teclado propio (no se guarda en el navegador).
- Viaja en crudo solo por HTTPS a `POST /api/login`. **El hash se calcula en el servidor.**
- Se guarda como `HMAC-SHA256(pin, PIN_PEPPER)` en `salones.pin_hash_v2` o en `trabajadoras[].pin_hash`.
- Los PINs viejos (SHA-256 sin pepper) se migran solos al primer login correcto.
- Un PIN es único en todo el sistema: el login no pide salón, así que dos iguales chocarían. `pinEnUso()` (`lib/auth.js`) lo verifica contra dueñas (hash nuevo y legacy) y trabajadoras de todos los salones. Lo usan `trabajador-pin.js` (409) y `crear-salon.js`.

### Rate limit
- 5 intentos fallidos por IP en 15 minutos → `429`. Cada intento se guarda en `login_attempts`.
- La IP sale del primer valor de `x-forwarded-for` (lo pone Vercel).

### Token de sesión
- Formato propio: `base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))`.
- Payload: `{ sid: <uuid del salón>, role, worker, exp }`. Dura 8 horas.
- Verificación con `crypto.timingSafeEqual` (sin fugas por tiempo).
- Se guarda en `localStorage`. **No hay revocación**: cambiar un PIN o quitar un acceso no cierra sesiones abiertas hasta que expiran. Rotar `SESSION_SECRET` cierra todas.

### Face ID / Touch ID (WebAuthn)
- Solo se activa desde dentro de la app, con una sesión de PIN ya abierta.
- Autenticador de plataforma, `userVerification: 'required'`, llave residente, sin attestation.
- Challenge firmado con HMAC (5 min), atado al salón, rol y trabajadora en el registro.
- Se valida origen y RP ID contra el host del request. El contador se actualiza en cada login.
- Una credencial de trabajadora solo entra si ella sigue en el catálogo con PIN. Quitarle el acceso o borrarla borra sus credenciales.

## 3. Autorización

**Regla de oro:** el `salon_id` de cada consulta sale del token verificado.
El `sheet_id` que manda el frontend se ignora.

| Guardia | Uso |
|---|---|
| `requireSession(req, res)` | Endpoints donde la trabajadora también entra. El handler filtra por rol |
| `requireOwnerSession(req, res)` | Endpoints solo de la dueña. Responde 403 a una trabajadora |
| `getSessionRole(req)` | Ramificar el comportamiento dentro de un endpoint |

Restricciones de trabajadora aplicadas **en el servidor**:
- `GET /api/clientas` le devuelve solo nombres: `notas_fijas` y `telefonos` siempre vacíos. El historial le da 403.
- `POST /api/clientas`: 403. (El permiso `telefonos` que lo permitía se retiró en v50; uno que haya quedado guardado en la base ya no vale.)
- Permisos extra: hoy `PERMISOS_TRABAJADORA` está vacío. Si se agrega uno, se lee de la base en cada llamada (`permisosDeTrabajadora()`), no del token, y solo la dueña lo cambia (`POST /api/trabajador-pin` con `permisos`, solo llaves conocidas con valor booleano).
- `POST /api/citas`: solo comisiones a su nombre. Puede aplicar un anticipo de la Agenda (`anticipo_origen_id`) y leer la lista de anticipos pendientes (`GET /api/citas?anticipos=pendientes`: id, clienta, fecha y monto de cada uno), porque la necesita para registrar bien la cita. No es dinero agregado del salón.
- `GET /api/citas?fecha=`, `PATCH` y `DELETE` de citas: 403.
- Gastos, comisiones, dashboard, config, PINs y push: 403.

El frontend además esconde esas pantallas (`RUTAS_TRABAJADORA`) y botones. Es
comodidad, no seguridad.

## 4. Protección de datos

| Riesgo | Control |
|---|---|
| Inyección SQL | Queries parametrizadas con el tagged template de `neon`. Cero concatenación |
| XSS | `escapeHTML()` en todo dato dinámico + CSP `script-src 'self'` |
| Datos inválidos | Validadores de `lib/validate.js` en cada endpoint (tipos, rangos, longitudes) |
| Hash de PIN expuesto | `sanitizeTrabajadoras()` reemplaza `pin_hash` por `tiene_acceso` en cada respuesta |
| Inyectar un `pin_hash` o permisos al guardar el catálogo | `POST /api/config` solo toma el `nombre` de cada trabajadora; el PIN y los permisos se conservan de la base |
| Borrado accidental o malicioso | Todo es soft-delete; se puede recuperar con SQL |
| Acceso directo a la base | `DATABASE_URL` solo vive en Vercel. El navegador nunca habla con Neon |

## 5. Encabezados HTTP (`vercel.json`)

| Header | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | 2 años, subdominios, preload |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Cámara, micrófono y ubicación apagados |

Consecuencia del CSP: **no se pueden cargar scripts de CDNs.** Todo JS vive en el repo.

## 6. Secretos

| Variable | Si se filtra | Cómo rotarla |
|---|---|---|
| `DATABASE_URL` | Acceso total a los datos | Reset del password del rol en Neon, actualizar en Vercel, redeploy |
| `SESSION_SECRET` | Cualquiera firma sesiones de cualquier salón | Nuevo valor + redeploy. Todos vuelven a entrar con PIN. Los challenges de WebAuthn en curso fallan |
| `PIN_PEPPER` | Permite fuerza bruta offline de los hashes | Nuevo valor + **reasignar todos los PINs** (los hashes viejos dejan de servir) |
| `VAPID_PRIVATE_KEY` | Mandar push a los dispositivos suscritos | Nuevas llaves + todos reactivan notificaciones |
| `CRON_SECRET` | Disparar la limpieza diaria a mano (solo borra intentos de login de más de 30 días) | Nuevo valor en Vercel |

**Reglas:**
- Nunca en el repo. `.env` está en `.gitignore`. `.env.example` solo lleva nombres vacíos.
- `SESSION_SECRET` y `PIN_PEPPER` distintos entre sí, de al menos 32 bytes (`openssl rand -hex 32`).
- Nunca imprimir un secreto en logs ni en mensajes de error.
- `crear-salon.js` necesita el mismo `PIN_PEPPER` que producción.

## 7. Riesgos

| # | Riesgo | Impacto | Estado |
|---|---|---|---|
| S1 | Quitar acceso o borrar a una trabajadora no borraba su Face ID | Podía seguir entrando con biometría | ✅ Resuelto en v46 (C8) |
| S2 | `crear-salon.js --plantilla` copiaba el `pin_hash` de las trabajadoras | Dos salones con el mismo PIN | ✅ Resuelto en v46 (C5): copia solo el nombre |
| S3 | `crear-salon.js --pin` no revisaba si el PIN ya existía | Mismo choque de PINs | ✅ Resuelto en v46 (C6): usa `pinEnUso()` |
| S4 | Sin revocación de tokens | Una trabajadora despedida conserva su sesión hasta 8 h | Abierto. Rotar `SESSION_SECRET` en casos graves |
| S5 | `login_attempts` crecía sin límite | Tabla grande con el tiempo | ✅ Resuelto en v46 (C12): el cron borra lo de más de 30 días |
| S6 | Token en `localStorage` | Un XSS podría leerlo | Abierto. Mitigado con CSP estricto + `escapeHTML` en todo |
| S7 | Rate limit solo por IP | Un atacante con muchas IPs prueba más PINs | Abierto. 1 millón de combinaciones × 5 intentos / 15 min / IP |

## 8. Checklist de seguridad para cada cambio

- [ ] ¿El endpoint usa `requireSession` o `requireOwnerSession`?
- [ ] ¿Toda consulta filtra por el `salonId` del token?
- [ ] ¿Validé cada campo de entrada con `lib/validate.js`?
- [ ] ¿La trabajadora queda bloqueada **en el servidor** de lo que no debe ver?
- [ ] ¿Todo texto dinámico en HTML pasa por `escapeHTML`?
- [ ] ¿La respuesta evita mandar hashes, secretos o datos de más?
- [ ] ¿Un error de servidor responde un mensaje genérico, sin detalles internos?
