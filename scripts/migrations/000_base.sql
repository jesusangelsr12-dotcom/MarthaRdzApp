-- Tablas base: el esquema que existía antes de la migración 001. Se exportó
-- de la base real de producción (Neon) el 2026-09-26, quitando las columnas
-- que agregan después 001 a 007 (esas migraciones las vuelven a agregar).
--
-- Con este archivo se puede levantar una base desde cero:
--
--   for f in scripts/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
--
-- En la base de producción no hace nada (todo es `if not exists`).

create table if not exists salones (
  id            uuid primary key default gen_random_uuid(),
  salon_id      text not null unique,
  nombre        text not null,
  logo_url      text,
  pin_hash      text not null default '',
  servicios     jsonb not null default '[]'::jsonb,
  productos     jsonb not null default '[]'::jsonb,
  trabajadoras  jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists citas (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salones(id) on delete cascade,
  fecha        date not null,
  "timestamp"  text,
  clienta      text not null,
  items        jsonb not null,
  total        numeric not null,
  metodo_pago  text,
  nota         text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists citas_salon_fecha_idx on citas (salon_id, fecha);

create table if not exists clientas (
  id                   uuid primary key default gen_random_uuid(),
  salon_id             uuid not null references salones(id) on delete cascade,
  clienta              text not null,
  clienta_normalizada  text not null,
  nota_fija            text not null default '',
  actualizado          date,
  created_at           timestamptz not null default now(),
  unique (salon_id, clienta_normalizada)
);

create table if not exists comisiones (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salones(id) on delete cascade,
  fecha        date not null,
  "timestamp"  text,
  clienta      text,
  trabajadora  text not null,
  item         text,
  tipo         text,
  costo        numeric,
  pct          numeric,
  comision     numeric,
  created_at   timestamptz not null default now()
);

create index if not exists comisiones_salon_fecha_idx on comisiones (salon_id, fecha);

create table if not exists gastos (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salones(id) on delete cascade,
  fecha        date not null,
  "timestamp"  text,
  descripcion  text not null,
  monto        numeric not null,
  metodo_pago  text,
  created_at   timestamptz not null default now()
);

create index if not exists gastos_salon_fecha_idx on gastos (salon_id, fecha);
