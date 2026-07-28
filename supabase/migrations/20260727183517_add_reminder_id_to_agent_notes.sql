-- Notas ligadas a un recordatorio.
-- Origen: el share target de la app (compartir un archivo/texto desde otra app
-- y asignarlo a un recordatorio). Igual que contact_id/policy_id, es opcional:
-- una nota puede ser global, de cliente, de póliza y/o de recordatorio.
-- on delete set null para no perder la nota si el recordatorio se borra duro.
ALTER TABLE agent_notes
  ADD COLUMN IF NOT EXISTS reminder_id uuid REFERENCES reminders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_notes_reminder ON agent_notes(reminder_id);
