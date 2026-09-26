-- Vacaciones / días libres de la dueña o de una trabajadora, para marcarlos
-- en el calendario. Tabla nueva y aditiva — no toca nada existente.
create table if not exists ausencias (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salones(id) on delete cascade,
  trabajadora text, -- null = es la dueña
  desde date not null,
  hasta date not null,
  nota text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ausencias_rango_valido check (hasta >= desde)
);

create index if not exists idx_ausencias_salon_rango on ausencias (salon_id, desde, hasta) where deleted_at is null;
