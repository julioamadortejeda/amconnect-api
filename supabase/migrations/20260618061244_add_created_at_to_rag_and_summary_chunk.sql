-- Recreate search_agent_note_chunks to include created_at so the AI can reference when a note was recorded.
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
  source_type text,
  created_at  timestamptz
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
    n.source_type,
    n.created_at
  FROM agent_note_chunks c
  JOIN agent_notes n ON n.id = c.note_id
  WHERE c.agent_id = p_agent_id
    AND n.is_active = true
    AND 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
