-- Registrar el modelo TTS del chat de voz turn-based (walkie-talkie) en el
-- catálogo de modelos de IA. Precios oficiales de Google AI Studio (Standard
-- tier, 2026-07): entrada $1.00/1M tokens, salida (audio) $20.00/1M tokens.
insert into ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m)
values (
  'gemini-3.1-flash-tts-preview',
  'gemini_api',
  'Gemini 3.1 Flash TTS',
  1.000000,
  20.000000
)
on conflict (model_name) do nothing;

-- Acumulados de uso de TTS por sesión — mismo patrón que extraction_*/embedding_*
-- en 024_ai_cost_tracking.sql. Se acumulan turno a turno (una sesión de
-- chat_tts puede tener varios mensajes, cada uno con su propia síntesis).
alter table ai_sessions
  add column tts_model_name        text references ai_models(model_name),
  add column tts_prompt_tokens     int not null default 0,
  add column tts_completion_tokens int not null default 0,
  add column tts_total_tokens      int not null default 0;
