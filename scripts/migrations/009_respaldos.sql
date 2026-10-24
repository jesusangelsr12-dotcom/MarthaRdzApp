-- Bitácora del respaldo diario a Google Drive — aplicar UNA VEZ antes de
-- desplegar el código que la acompaña. Aditiva e idempotente: no toca
-- ninguna tabla existente.
--
--   psql "$DATABASE_URL" -f scripts/migrations/009_respaldos.sql
--
-- Cada noche (cron /api/cron/limpieza?tarea=respaldo) y con «Respaldar
-- ahora» se exporta la base completa a la carpeta «Martha Rdz - Base de
-- Datos» de Google Drive (lib/respaldo.js). Aquí queda una fila por
-- intento, bien o mal, para que la dueña vea en Configuración → Respaldo si
-- el último salió. No es por salón: el respaldo es de toda la base. Las
-- filas de más de 400 días se borran solas.

create table if not exists respaldos (
  id           uuid primary key default gen_random_uuid(),
  creado_at    timestamptz not null default now(),
  origen       text not null check (origen in ('cron', 'manual')),
  ok           boolean not null,
  archivo      text,                 -- marthardz-respaldo-2026-10-24.json.gz
  bytes        integer,              -- tamaño del .json.gz
  filas        integer,              -- registros en el archivo
  drive_id     text,                 -- id del archivo en Drive
  carpeta_url  text,
  error        text,                 -- por qué falló (si falló)
  duracion_ms  integer
);

create index if not exists idx_respaldos_creado on respaldos (creado_at desc);
