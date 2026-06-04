-- Agrega soporte para cancelación de pending tasks cuando el usuario sale del chat
alter table ai_pending_tasks
  add column cancellation_reason text;

-- Documenta los valores válidos de status como constraint
alter table ai_pending_tasks
  add constraint ai_pending_tasks_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'cancelled'));
