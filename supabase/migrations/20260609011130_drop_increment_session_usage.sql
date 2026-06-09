-- Lógica movida a TypeScript (read-then-write en saveChatRound).
-- Sin concurrencia real por sesión — los mensajes son secuenciales.
drop function if exists increment_session_usage(uuid, int4, int4, int4);