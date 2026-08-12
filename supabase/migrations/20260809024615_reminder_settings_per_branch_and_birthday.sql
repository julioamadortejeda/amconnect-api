-- Configuración de avisos por ramo + nuevo tipo de recordatorio BIRTHDAY.
--
-- reminder_settings pasa de (agente, tipo) a (agente, tipo, ramo):
--   · fila con branch_id NULL  → default del asesor para ese tipo
--   · fila con branch_id       → pisa el default para ese ramo
-- Ej: "pagos 15 días antes" (default) + "pagos de Gastos Médicos 30 días antes".

alter table reminder_settings
  add column branch_id uuid references branches(id) on delete cascade;

alter table reminder_settings
  drop constraint if exists reminder_settings_agent_id_reminder_type_id_key;

-- Postgres trata dos NULL como distintos, así que el unique va partido en dos
-- índices parciales para que la fila default también quede única por tipo.
create unique index reminder_settings_default_uniq
  on reminder_settings (agent_id, reminder_type_id)
  where branch_id is null;

create unique index reminder_settings_branch_uniq
  on reminder_settings (agent_id, reminder_type_id, branch_id)
  where branch_id is not null;

alter table reminder_settings
  add constraint reminder_settings_days_before_non_negative
  check (days_before >= 0);

create index idx_reminder_settings_agent_id on reminder_settings(agent_id);

insert into reminder_types (name, code) values
  ('Birthday', 'BIRTHDAY')
on conflict (code) do nothing;
