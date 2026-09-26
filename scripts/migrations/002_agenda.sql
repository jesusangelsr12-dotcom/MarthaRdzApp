-- Agendar Cita + anticipos — aplicar UNA VEZ antes de desplegar el código que
-- la acompaña. Todo es aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/002_agenda.sql

create table if not exists citas_agendadas (
  id                    uuid primary key default gen_random_uuid(),
  salon_id              uuid not null references salones(id) on delete cascade,
  clienta               text not null,
  fecha                 date not null,
  hora                  text not null
    check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  anticipo              numeric not null default 0 check (anticipo >= 0),
  anticipo_metodo_pago  text,
  nota                  text not null default '',
  estado                text not null default 'pendiente'
    check (estado in ('pendiente', 'completada', 'no_asistio', 'cancelada')),
  deposito_cita_id      uuid references citas(id),
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index if not exists idx_citas_agendadas_salon_fecha
  on citas_agendadas (salon_id, fecha) where deleted_at is null;

-- Enlaza una fila de `citas` (dinero real) con la cita agendada que la originó.
alter table citas add column if not exists agenda_id uuid references citas_agendadas(id);
alter table citas add column if not exists anticipo_aplicado numeric;

create index if not exists idx_citas_agenda_id on citas (agenda_id) where agenda_id is not null;
