-- Teléfono de la clienta — aplicar UNA VEZ antes de desplegar el código que
-- la acompaña. Aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/004_clienta_telefono.sql
--
-- Es la base para "Compartir por WhatsApp" y "Confirmar cita por WhatsApp":
-- ambos necesitan el celular de la clienta para armar el link de wa.me.
-- Mismo patrón que nota_fija: texto vacío por default (nunca null), 10
-- dígitos cuando sí se captura (validado en lib/validate.js, sin el 52 de
-- país — se antepone al armar el link, no al guardar).

alter table clientas add column if not exists telefono text not null default '';
