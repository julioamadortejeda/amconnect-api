-- Elimina la tabla legacy de embeddings (reemplazada por agent_notes + agent_note_chunks en migración 020)
-- La función search_agent_notes también se elimina; su reemplazo es search_agent_note_chunks (migración 020)
DROP FUNCTION IF EXISTS search_agent_notes(vector, uuid, float, int);
DROP TABLE IF EXISTS agent_notes_vectors;
