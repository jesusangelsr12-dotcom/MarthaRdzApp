-- Notificaciones push — aplicar UNA VEZ antes de desplegar el código que la
-- acompaña. Aditivo: no borra ni reescribe datos existentes.
--
--   psql "$DATABASE_URL" -f scripts/migrations/005_push_subscriptions.sql
--
-- Una fila por dispositivo suscrito (la dueña puede tener el celular y una
-- tablet, por ejemplo). `endpoint` es único porque el navegador lo genera:
-- si vuelve a suscribirse desde el mismo dispositivo (o cambia de llaves),
-- el upsert en api/push-subscribe.js actualiza la fila en vez de duplicarla.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references salones(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_salon on push_subscriptions (salon_id);
