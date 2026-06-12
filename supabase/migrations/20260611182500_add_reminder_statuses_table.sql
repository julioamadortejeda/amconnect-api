create table reminder_statuses (
  id          uuid primary key default uuid_generate_v4(),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed statuses
insert into reminder_statuses (code, name) values
  ('PENDING', 'Pendiente'),
  ('IN_PROGRESS', 'En Progreso'),
  ('DONE', 'Completado'),
  ('CANCELLED', 'Cancelado');

-- Add columns to reminders
alter table reminders add column status_id uuid references reminder_statuses(id);
alter table reminders add column comments text;

-- Migrate existing data
update reminders r
set status_id = (select id from reminder_statuses where code = 'DONE')
where r.is_done = true;

update reminders r
set status_id = (select id from reminder_statuses where code = 'PENDING')
where r.is_done = false or r.is_done is null;

-- Make status_id non-nullable after migration
alter table reminders alter column status_id set not null;

-- Drop obsolete column
alter table reminders drop column is_done;
