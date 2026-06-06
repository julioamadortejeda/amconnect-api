-- Renombrar columna ai_content a content en la tabla agent_notes
ALTER TABLE agent_notes RENAME COLUMN ai_content TO content;
