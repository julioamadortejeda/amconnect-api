-- Añadir columna duration_seconds a ai_sessions para registrar la duración de sesiones de voz
ALTER TABLE ai_sessions ADD COLUMN duration_seconds INT;
