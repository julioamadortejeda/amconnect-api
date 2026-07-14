-- Enable full replica identity so UPDATE/DELETE events include the complete old row.
ALTER TABLE carriers REPLICA IDENTITY FULL;
ALTER TABLE branches REPLICA IDENTITY FULL;
ALTER TABLE products REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication.
-- The Realtime service subscribes to this publication via logical replication;
-- tables not listed here are invisible to it.
ALTER PUBLICATION supabase_realtime ADD TABLE carriers;
ALTER PUBLICATION supabase_realtime ADD TABLE branches;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
