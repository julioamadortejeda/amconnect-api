-- Candado de turno por sesión de chat (bug #6 de la caracterización del asistente).
--
-- Dos mensajes simultáneos en la misma sesión leían el historial completo, lo
-- extendían y lo escribían de vuelta: el último en guardar pisaba al primero y
-- ambos gastaban Gemini. Ahora cada turno toma el candado antes de gastar nada:
--
--   update ai_sessions set turn_locked_until = <ahora + N s>
--    where id = :id and (turn_locked_until is null or turn_locked_until < <ahora>)
--
-- Un solo UPDATE condicional (atómico en Postgres) por el cliente del asesor, así
-- que aplica la policy "ai_sessions: own records". La expiración hace que un
-- proceso caído a media vuelta no deje la conversación bloqueada para siempre.
alter table ai_sessions
  add column if not exists turn_locked_until timestamptz;

comment on column ai_sessions.turn_locked_until is
  'Candado de turno del chat de texto: mientras sea futuro hay un turno en curso y se rechazan otros mensajes de la sesión (409). Null o pasado = libre.';
