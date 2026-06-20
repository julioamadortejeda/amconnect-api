-- Add policy_changelog as valid note_origin for update changelog notes
ALTER TABLE agent_notes
  ADD CONSTRAINT agent_notes_note_origin_check
  CHECK (note_origin IN ('knowledge', 'policy', 'policy_changelog'));
