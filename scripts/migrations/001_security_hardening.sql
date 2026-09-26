-- Migración de seguridad — aplicar UNA VEZ antes de desplegar el código
-- que la acompaña (login con pepper, autorización por sesión y borrado
-- no destructivo de citas/gastos).
--
-- Todo es aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/001_security_hardening.sql

-- Hash de PIN con pepper del servidor (HMAC-SHA256). Se llena solo, salón
-- por salón, la próxima vez que cada uno inicie sesión (ver api/login.js).
alter table salones add column if not exists pin_hash_v2 text;

-- Borrado no destructivo: DELETE ahora marca deleted_at en vez de borrar
-- la fila, para poder recuperar una cita/gasto eliminado por error.
alter table citas  add column if not exists deleted_at timestamptz;
alter table gastos add column if not exists deleted_at timestamptz;

-- Rate limiting de /api/login por IP (el PIN es de solo 6 dígitos: sin
-- esto se puede probar el millón de combinaciones en minutos).
create table if not exists login_attempts (
  id bigserial primary key,
  ip text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_login_attempts_ip_time
  on login_attempts (ip, attempted_at);
