-- Enable full replica identity so UPDATE events include the complete old row.
-- Required for Realtime to populate payload.oldRecord on updates/deletes.
ALTER TABLE reminders REPLICA IDENTITY FULL;
ALTER TABLE contacts  REPLICA IDENTITY FULL;
ALTER TABLE policies  REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication.
-- The Realtime service subscribes to this publication via logical replication;
-- tables not listed here are invisible to it.
ALTER PUBLICATION supabase_realtime ADD TABLE reminders;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE policies;
