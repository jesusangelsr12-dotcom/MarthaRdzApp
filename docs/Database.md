# Base de datos · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Motor:** PostgreSQL en Neon · **Acceso:** solo desde las serverless functions

## 1. Modelo

```
                          ┌──────────────────────────┐
                          │ salones                  │
                          │ id uuid PK               │
                          │ salon_id text (salon_001)│
                          │ servicios / productos    │  jsonb
                          │ trabajadoras             │  jsonb [{nombre, pin_hash?, permisos?}]
                          └────────────┬─────────────┘
          ┌──────────────┬─────────────┼──────────────┬───────────────┬──────────────────┐
          ▼              ▼             ▼              ▼               ▼                  ▼
   ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────────┐ ┌──────────┐ ┌──────────────────────┐
   │ citas      │ │ comisiones │ │ gastos   │ │ citas_agendadas│ │ clientas │ │ ausencias (sin uso)  │
   │ (dinero)   │ │            │ │          │ │ (sin uso, v50) │ │          │ │ push_subscriptions   │
   └─────┬──────┘ └─────▲──────┘ └──────────┘ └───────┬────────┘ └──────────┘ │ webauthn_credentials │
         │              │ (salon, fecha,              │                       └──────────────────────┘
         │              │  timestamp, clienta)        │
         └──────────────┘  vínculo lógico, sin FK     │
         citas.agenda_id ─────────────────────────────►│ id   (histórico, hasta v49)
         citas.anticipo_origen_id ──► citas.id  (fila de anticipo de la Agenda aplicada a esta cita, v50)

  login_attempts: independiente (rate limit por IP)
```

Todo cuelga de `salones.id`. Ninguna consulta de la API toca filas de otro
salón porque todas filtran por el `salon_id` que viene del token verificado.

## 2. Origen del esquema

| Parte | De dónde sale |
|---|---|
| `salones`, `citas`, `clientas`, `comisiones`, `gastos` | `scripts/migrations/000_base.sql`, exportado de la base real (Neon) tal como estaba antes de la 001 |
| Todo lo demás | `scripts/migrations/001` a `008`, en orden |

Con `000` a `008` se levanta una base completa desde cero. Las pruebas de
integración lo hacen en cada corrida (ver [Testing.md](Testing.md)).

## 3. Tablas

### `salones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | Lo que el frontend llama `sheet_id` (nombre heredado de Google Sheets) |
| `salon_id` | text | Clave legible `salon_001`, `salon_002`… La genera `crear-salon.js` |
| `nombre` | text | |
| `logo_url` | text | Opcional. Hoy la UI usa `/img/logo.png` fijo |
| `pin_hash` | text | **Legacy.** SHA-256 sin pepper. `''` en salones nuevos |
| `pin_hash_v2` | text | HMAC-SHA256(PIN, `PIN_PEPPER`). Se llena solo en el primer login (mig. 001) |
| `servicios` | jsonb | `["Corte", "Tinte", …]` |
| `productos` | jsonb | `["Shampoo", …]` |
| `trabajadoras` | jsonb | `[{"nombre":"Ana","pin_hash":"…","permisos":{…}}]`. `pin_hash` solo si tiene acceso; **nunca sale al cliente**. `permisos` es opcional: solo valen los de `PERMISOS_TRABAJADORA` en `lib/auth.js` (hoy ninguno). Un `{"telefonos":true}` guardado antes de v50 se conserva pero ya no vale. No necesita migración |

### `citas` (dinero cobrado)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | No se expone al frontend |
| `salon_id` | uuid FK | |
| `fecha` | date | Día de la cita (ahí cuenta todo su `total`) |
| `timestamp` | text | Hora local del dispositivo, `HH:MM:SS` |
| `clienta` | text | Tal como se escribió |
| `items` | jsonb | `[{tipo, nombre, costo}]`. `tipo`: `servicio`, `producto` o `anticipo` |
| `total` | numeric | Precio completo de la cita, **anticipo incluido** (v50). En citas cobradas desde la Agenda (hasta v49) es lo cobrado ese día, ya descontado `anticipo_aplicado` |
| `metodo_pago` | text | `Efectivo` · `Tarjeta` · `Transferencia` |
| `nota` | text | Fórmula o notas de la visita |
| `anticipo` | numeric, default 0 | Parte de `total` que ya estaba pagada (mig. 008). Check `0 ≤ anticipo ≤ total` |
| `anticipo_origen_id` | uuid FK → `citas.id` | Fila de anticipo de la Agenda que se aplicó a esta cita (mig. 008) |
| `agenda_id` | uuid FK → `citas_agendadas.id` | Histórico: si vino de una cita agendada (mig. 002). Ya no se escribe |
| `anticipo_aplicado` | numeric | Histórico: desglose de citas cobradas desde la Agenda (mig. 002). Ya no se escribe |
| `deleted_at` | timestamptz | Borrado lógico (mig. 001) |

**Identidad lógica:** `(salon_id, fecha, timestamp, clienta)`. PATCH y DELETE la usan.

**Fila de anticipo (de la Agenda, hasta v49):** un solo item `{"tipo":"anticipo","nombre":"Anticipo — <clienta>","costo":N}`,
con `agenda_id` apuntando a la cita agendada. Cuenta como ingreso en su día, no como visita.
Mientras siga viva es un **anticipo pendiente** (`GET /api/citas?anticipos=pendientes`).
Al aplicarla a una cita se oculta con `deleted_at` y la cita guarda su id en
`anticipo_origen_id`. Ya no se crean filas nuevas así.

### `comisiones`

| Columna | Tipo | Notas |
|---|---|---|
| `salon_id` | uuid FK | |
| `fecha`, `timestamp`, `clienta` | | Iguales a los de su cita (así se enlazan) |
| `trabajadora` | text | Nombre, no id |
| `item`, `tipo` | text | Servicio o producto comisionado |
| `costo` | numeric | Precio completo del item |
| `pct` | numeric | 0 a 100 |
| `comision` | numeric | `round(costo × pct / 100, 2)`, calculado en el cliente y validado en rango |
| `deleted_at` | timestamptz | Se marca junto con su cita (mig. 003) |

### `gastos`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | PK | |
| `salon_id` | uuid FK | |
| `fecha` | date | Siempre "hoy" del dispositivo |
| `timestamp` | text | `HH:MM:SS` |
| `descripcion` | text | Máx. 300 caracteres |
| `monto` | numeric | 0 a 10,000,000 |
| `metodo_pago` | text | |
| `deleted_at` | timestamptz | (mig. 001) |

**Identidad lógica:** `(salon_id, fecha, timestamp, descripcion)`.

### `clientas` (ficha fija)

| Columna | Tipo | Notas |
|---|---|---|
| `salon_id` | uuid FK | |
| `clienta` | text | Grafía preferida |
| `clienta_normalizada` | text | Minúsculas, sin acentos, espacios colapsados. **Único por salón** |
| `nota_fija` | text | Alergias, preferencias. `''` si no hay |
| `telefono` | text | 10 dígitos sin el 52, o `''` (mig. 004) |
| `actualizado` | date | |

Una clienta **existe** si tiene al menos una cita o una fila aquí. El
historial agrupa citas con esta tabla por `clienta_normalizada`.

### `citas_agendadas` (mig. 002) — sin uso desde v50

La Agenda se retiró en v50. La tabla y sus filas se quedan como estaban
(nada se borró); ningún endpoint la lee ni la escribe. El `estado` de sus
filas ya no se actualiza.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `salon_id` | uuid FK | `on delete cascade` |
| `clienta` | text | |
| `fecha` | date | Día de la cita |
| `hora` | text | `HH:MM` 24 h (check con regex) |
| `anticipo` | numeric ≥ 0 | |
| `anticipo_metodo_pago` | text | Solo si `anticipo > 0` |
| `nota` | text | |
| `estado` | text | `pendiente` · `completada` · `no_asistio` · `cancelada` |
| `deposito_cita_id` | uuid FK → `citas.id` | Fila del anticipo |
| `created_at`, `deleted_at` | timestamptz | |

Índice: `(salon_id, fecha) where deleted_at is null`.

### `ausencias` (mig. 007) — sin uso desde v50

Las vacaciones/días libres vivían en la Agenda. La tabla se queda; ningún
endpoint la usa.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `salon_id` | uuid FK | cascade |
| `trabajadora` | text | `null` = la dueña |
| `desde`, `hasta` | date | Check `hasta >= desde` |
| `nota` | text | |
| `created_at`, `deleted_at` | timestamptz | |

### `push_subscriptions` (mig. 005)

Una fila por dispositivo. `endpoint` es único: re-suscribirse actualiza la fila.
Se borra sola cuando el push service responde 404 o 410.

| Columna | Tipo |
|---|---|
| `id` | uuid PK |
| `salon_id` | uuid FK cascade |
| `endpoint` | text único |
| `p256dh`, `auth` | text |
| `created_at` | timestamptz |

### `webauthn_credentials` (mig. 006)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `salon_id` | uuid FK cascade | |
| `role` | text | `duena` o `trabajadora` |
| `worker` | text | Nombre de la trabajadora, fijo desde el registro |
| `credential_id` | text único | Lo genera el dispositivo |
| `public_key` | text | base64url |
| `counter` | bigint | Se actualiza en cada login |
| `device_label` | text | `iPhone`, `iPad`, `Android`… |

### `login_attempts` (mig. 001)

`(id, ip, success, attempted_at)` con índice `(ip, attempted_at)`. El cron diario (`/api/cron/limpieza`) borra las filas de más de 30 días.

## 4. Reglas de datos

1. **Todo borrado es lógico.** `update … set deleted_at = now()`. Toda lectura filtra `deleted_at is null`.
2. **Restaurar** = `deleted_at = null`. Solo desde el botón "Deshacer" (no hay papelera en la UI).
3. **En cascada lógica:**
   - Borrar cita → borra sus comisiones (mismo salón, fecha, timestamp y clienta).
   - Borrar una cita con `anticipo_origen_id` → su fila de anticipo de la Agenda vuelve a quedar viva (pendiente, en su día original). Restaurar la cita la vuelve a ocultar; si mientras tanto se aplicó a otra cita, el restore se rechaza (409).
4. **El anticipo va dentro del total.** `total` es el precio completo; `anticipo` solo dice cuánto ya estaba pagado. Ingresos = `sum(total)`. Las comisiones salen del precio completo de cada item.
5. **Candado del anticipo de la Agenda:** `update citas set deleted_at = now() where id = <origen> and deleted_at is null and total = <anticipo> and items @> '[{"tipo":"anticipo"}]'`. Si no toca filas, se rechaza la cita (409). Va en la **misma sentencia** que el insert de la cita y de sus comisiones: todo o nada.
6. **Dinero:** `numeric`, sin centavos flotantes. El cliente manda números; el servidor valida rangos.
7. **Fechas:** `date` en ISO (`YYYY-MM-DD`). `timestamp` de citas y gastos es texto libre de la hora local. Lo que fecha el servidor usa `fechaMexico()` (`lib/fecha.js`), nunca la fecha UTC.
8. **Consultas siempre parametrizadas** con el tagged template de `neon` (`sql\`… ${valor}\``). Nunca concatenar.

## 5. Consultas que conviene conocer

```sql
-- Ingresos del día (el anticipo de cada cita ya va dentro de su total;
-- también suman los anticipos de la Agenda que siguen pendientes en ese día)
select sum(total) from citas
where salon_id = $1 and fecha = $2 and deleted_at is null;

-- Anticipos de la Agenda que todavía no se aplican a una cita
select id, fecha, clienta, total from citas
where salon_id = $1 and deleted_at is null
  and items @> '[{"tipo":"anticipo"}]'::jsonb;

-- Visitas (excluye filas de solo anticipo)
select count(*) from citas
where salon_id = $1 and deleted_at is null
  and not (items @> '[{"tipo":"anticipo"}]'::jsonb);

-- Recuperar un registro borrado sin la UI
update citas set deleted_at = null
where salon_id = $1 and fecha = $2 and clienta = $3 and deleted_at is not null;
```

## 6. Migraciones

| # | Archivo | Qué agrega |
|---|---|---|
| 000 | `000_base.sql` | Tablas base: `salones`, `citas`, `clientas`, `comisiones`, `gastos` |
| 001 | `001_security_hardening.sql` | `pin_hash_v2`, `deleted_at` en citas y gastos, `login_attempts` |
| 002 | `002_agenda.sql` | `citas_agendadas`, `citas.agenda_id`, `citas.anticipo_aplicado` |
| 003 | `003_comisiones_soft_delete.sql` | `comisiones.deleted_at` |
| 004 | `004_clienta_telefono.sql` | `clientas.telefono` |
| 005 | `005_push_subscriptions.sql` | `push_subscriptions` |
| 006 | `006_webauthn.sql` | `webauthn_credentials` |
| 007 | `007_ausencias.sql` | `ausencias` |
| 008 | `008_anticipo_en_cita.sql` | `citas.anticipo` (check `0 ≤ anticipo ≤ total`), `citas.anticipo_origen_id` y su índice |

**Reglas para una migración nueva:**
- Nombre `NNN_descripcion.sql`, número siguiente.
- Solo aditiva e idempotente (`if not exists`). Nada de `drop` ni `rename` sin plan de datos.
- Encabezado con qué hace y el comando para aplicarla.
- Se aplica **antes** de desplegar el código que la usa.
- Se documenta aquí y en el [CHANGELOG](../CHANGELOG.md).

## 7. Respaldos

Neon guarda historial del branch principal (point-in-time restore según el
plan contratado). Antes de una migración con riesgo, crear un branch de Neon
como respaldo. Detalle en [Deployment.md](Deployment.md).
