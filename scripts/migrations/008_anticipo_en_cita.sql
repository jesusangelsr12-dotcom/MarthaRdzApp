-- Anticipo dentro de la cita (v50) — aplicar UNA VEZ antes de desplegar el
-- código que la acompaña. Aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/008_anticipo_en_cita.sql
--
-- Sin Agenda, el anticipo se captura al registrar la cita y es PARTE del
-- total: una cita de $2,500 con $500 de anticipo guarda total = 2500 y
-- anticipo = 500. Los 2500 cuentan como ingreso el día de la cita y las
-- comisiones salen sobre el precio completo. (Distinto de la columna vieja
-- `anticipo_aplicado`, de la Agenda, donde `total` ya venía con el anticipo
-- restado; esa columna se queda tal cual para los registros de antes.)
--
-- `anticipo_origen_id`: cuando el anticipo ya estaba registrado como fila
-- propia de la Agenda vieja (items = [{tipo:'anticipo'}]), esa fila se
-- oculta con deleted_at al registrar la cita (para no contarlo dos veces) y
-- aquí queda de dónde vino, para regresarla si la cita se elimina.

alter table citas add column if not exists anticipo numeric not null default 0;
alter table citas add column if not exists anticipo_origen_id uuid references citas(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'citas_anticipo_valido') then
    alter table citas add constraint citas_anticipo_valido check (anticipo >= 0 and anticipo <= total);
  end if;
end $$;

create index if not exists idx_citas_anticipo_origen
  on citas (anticipo_origen_id) where anticipo_origen_id is not null;
