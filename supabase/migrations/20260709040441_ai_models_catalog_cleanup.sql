-- Catálogo ai_models: alta del modelo live de Vertex, limpieza de filas sin uso.
--
-- Precios verificados 2026-07-08 contra ai.google.dev/gemini-api/docs/pricing y
-- la página de precios de Gemini Enterprise Agent Platform (Vertex):
--   - gemini-3.1-flash-lite: $0.25 in / $1.50 out / $0.025 cache (idéntico en
--     Studio y Vertex endpoint global; regional sería +10%)
--   - live/native-audio: se cotiza la tarifa de AUDIO (in $3 / out $12) porque
--     las sesiones de voz son audio-dominantes; el tramo de texto es menor.
--   - TTS: $1.00 in (texto) / $20.00 out (audio). Embedding: $0.20 in.

-- Modelo live que usa AI_BACKEND=vertex (región us-central1). Mismo precio de
-- audio que en Studio.
INSERT INTO ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m, cache_read_cost_per_1m, is_active)
VALUES ('gemini-live-2.5-flash-native-audio', 'vertex_ai', 'Gemini Live 2.5 Flash Native Audio', 3.000000, 12.000000, 0, true)
ON CONFLICT (model_name) DO UPDATE
  SET provider = EXCLUDED.provider,
      display_name = EXCLUDED.display_name,
      input_cost_per_1m = EXCLUDED.input_cost_per_1m,
      output_cost_per_1m = EXCLUDED.output_cost_per_1m,
      is_active = true;

-- Filas sin ninguna referencia en ai_sessions/tokens_usage y sin uso en código:
--   - gemini-3.5-flash: nunca usado por el backend
--   - gemini-2.5-flash-native-audio-preview-12-2025: nombre viejo del live,
--     reemplazado por gemini-live-2.5-flash-native-audio
-- El guard NOT EXISTS hace el DELETE seguro también en producción: si alguna
-- fila llegara a tener referencias, se conserva.
DELETE FROM ai_models m
WHERE m.model_name IN ('gemini-3.5-flash', 'gemini-2.5-flash-native-audio-preview-12-2025')
  AND NOT EXISTS (
    SELECT 1 FROM ai_sessions s
    WHERE s.model_name = m.model_name
       OR s.embedding_model_name = m.model_name
       OR s.tts_model_name = m.model_name
  )
  AND NOT EXISTS (SELECT 1 FROM tokens_usage t WHERE t.model_name = m.model_name);
