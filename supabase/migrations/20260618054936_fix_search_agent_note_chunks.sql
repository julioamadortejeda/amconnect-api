-- Fix search_agent_note_chunks: remove reference to n.metadata (column was never added to agent_notes).
-- Without this fix the function throws at runtime and the RAG service silently returns [].
-- DROP required because CREATE OR REPLACE cannot change the RETURNS signature.
DROP FUNCTION IF EXISTS search_agent_note_chunks(uuid, vector, float, int);

CREATE OR REPLACE FUNCTION search_agent_note_chunks(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.7,
  p_match_count     int   default 5
)
RETURNS TABLE (
  chunk_id    uuid,
  note_id     uuid,
  content     text,
  similarity  float,
  contact_id  uuid,
  policy_id   uuid,
  source_type text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id        AS chunk_id,
    c.note_id,
    c.content,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    n.contact_id,
    n.policy_id,
    n.source_type
  FROM agent_note_chunks c
  JOIN agent_notes n ON n.id = c.note_id
  WHERE c.agent_id = p_agent_id
    AND n.is_active = true
    AND 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Add 'whatsapp' to the source_type check constraint so WhatsApp ingestion doesn't fail at insert.
ALTER TABLE agent_notes DROP CONSTRAINT IF EXISTS agent_notes_source_type_check;
ALTER TABLE agent_notes ADD CONSTRAINT agent_notes_source_type_check
  CHECK (source_type = ANY (ARRAY['pdf','image','audio','document','text','whatsapp']));
