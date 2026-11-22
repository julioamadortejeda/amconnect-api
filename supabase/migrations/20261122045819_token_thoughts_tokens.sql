-- Tokens de razonamiento (thoughts) de los modelos "pensantes".
--
-- Se cobran a tarifa de salida pero los proveedores NO los incluyen en los
-- tokens de salida visibles (completion_tokens), así que el costo se
-- subestimaba. Columna provider-agnóstica: cada proveedor la llena con lo que
-- reporte (Gemini: thoughtsTokenCount / total_thought_tokens); 0 si no hay.
-- total_tokens pasa a ser prompt + completion + thoughts (lo calcula el
-- backend al insertar; las filas históricas se quedan con thoughts = 0 porque
-- ese dato nunca se guardó y no es recuperable).
--
-- Sin cambios de RLS/GRANTs: los permisos de tokens_usage son a nivel tabla
-- (select/insert own; sin update/delete).
alter table tokens_usage
  add column thoughts_tokens integer not null default 0;

-- ai_sessions.cached_tokens quedó huérfana: la migración
-- 20260708022000_centralize_tokens_usage movió los tokens a tokens_usage y
-- borró prompt/completion/total de ai_sessions, pero se olvidó de esta
-- columna. Nada la escribe desde entonces (por eso siempre valía 0). El
-- acumulado de sesión se calcula sumando tokens_usage, única fuente de verdad.
alter table ai_sessions
  drop column if exists cached_tokens;
