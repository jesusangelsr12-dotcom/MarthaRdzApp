-- Face ID / Touch ID (WebAuthn) — aplicar UNA VEZ antes de desplegar el
-- código que la acompaña. Aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/006_webauthn.sql
--
-- Una fila por dispositivo con biometría activada. `credential_id` es único
-- porque lo genera el propio dispositivo (su enclave seguro) al registrar
-- — es como buscamos a quién pertenece al iniciar sesión con Face ID/Touch
-- ID, sin volver a pedir el PIN. `role`/`worker` quedan fijos desde el
-- registro: si la dueña le da Face ID a Aly y luego la renombra, su
-- biometría sigue funcionando (mismo caso ya documentado para su PIN).

create table if not exists webauthn_credentials (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references salones(id) on delete cascade,
  role           text not null default 'duena' check (role in ('duena', 'trabajadora')),
  worker         text,
  credential_id  text not null unique,
  public_key     text not null,
  counter        bigint not null default 0,
  device_label   text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists idx_webauthn_salon on webauthn_credentials (salon_id);
