-- ─── Recordatorios ────────────────────────────────────────────────────────────

create table reminders (
  id            uuid primary key default uuid_generate_v4(),
  agent_id      uuid not null references agents(id) on delete cascade,
  contact_id    uuid references contacts(id),
  policy_id     uuid references policies(id),
  type_id       uuid not null references reminder_types(id),
  title         text not null,
  description   text,
  due_date      timestamptz not null,
  is_done       boolean not null default false,
  notified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_reminders_agent_id on reminders(agent_id);
create index idx_reminders_due_date on reminders(due_date);
create index idx_reminders_is_done on reminders(is_done);

-- ─── Configuración de recordatorios automáticos ───────────────────────────────
-- Define cuántos días antes de un vencimiento se genera el recordatorio

create table reminder_settings (
  id                uuid primary key default uuid_generate_v4(),
  agent_id          uuid not null references agents(id) on delete cascade,
  reminder_type_id  uuid not null references reminder_types(id),
  days_before       int not null default 30,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique(agent_id, reminder_type_id)
);
