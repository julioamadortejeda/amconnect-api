-- Enable full replica identity so UPDATE/DELETE events include the complete old row.
ALTER TABLE agent_notes REPLICA IDENTITY FULL;

-- Add agent_notes to the Realtime publication so INSERT/UPDATE/DELETE events are broadcast.
ALTER PUBLICATION supabase_realtime ADD TABLE agent_notes;
