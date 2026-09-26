-- Las comisiones de una cita se identifican por (salon_id, fecha, timestamp,
-- clienta) — igual que la propia cita — porque no llevan un id de cita
-- enlazado. Al eliminar una cita, sus comisiones se quedaban huérfanas:
-- seguían contando en el reporte de Comisiones y en el Dashboard aunque el
-- ingreso ya no existiera. Este `deleted_at` permite borrarlas (y
-- restaurarlas) en conjunto con la cita, mismo patrón ya usado en
-- citas/gastos/citas_agendadas.
alter table comisiones add column if not exists deleted_at timestamptz;
