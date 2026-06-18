ALTER TABLE agent_notes
  ADD COLUMN IF NOT EXISTS note_origin text NOT NULL DEFAULT 'knowledge',
  ADD COLUMN IF NOT EXISTS summary text;

-- Backfill: notas que ya tienen policy_id son de extracción de póliza
UPDATE agent_notes SET note_origin = 'policy' WHERE policy_id IS NOT NULL;
