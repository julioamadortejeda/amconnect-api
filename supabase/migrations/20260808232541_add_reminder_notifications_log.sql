-- Log append-only de notificaciones de recordatorios enviadas por el cron.
-- `reminders.notified_at` sigue siendo el flag mutable que usa el cron para
-- dedup (findDueUnnotified); se resetea a null cuando se reagenda. Esta tabla
-- es el historial que NO se pierde con ese reset — una fila por cada push
-- efectivamente enviado.

create table reminder_notifications (
  id                uuid primary key default gen_random_uuid(),
  reminder_id       uuid not null references reminders(id) on delete cascade,
  agent_id          uuid not null,
  due_date_at_send  timestamptz not null,
  sent_at           timestamptz not null default now()
);

create index idx_reminder_notifications_reminder_id on reminder_notifications(reminder_id);
create index idx_reminder_notifications_agent_id on reminder_notifications(agent_id);

alter table reminder_notifications enable row level security;

create policy "reminder_notifications: own records"
  on reminder_notifications for all
  using (agent_id = auth.uid());
