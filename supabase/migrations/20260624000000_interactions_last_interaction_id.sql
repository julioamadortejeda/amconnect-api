-- Migración: Añadir last_interaction_id para Interactions API y registrar nuevo modelo de voz

ALTER TABLE ai_sessions ADD COLUMN last_interaction_id TEXT;

-- Registrar el nuevo modelo de voz recomendado gemini-3.1-flash-live-preview
-- Precios oficiales: entrada $3.60/1M, salida $21.60/1M
INSERT INTO ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m)
VALUES (
  'gemini-3.1-flash-live-preview',
  'gemini_api',
  'Gemini 3.1 Flash Live',
  3.600000,
  21.600000
)
ON CONFLICT (model_name) DO UPDATE SET
  input_cost_per_1m = EXCLUDED.input_cost_per_1m,
  output_cost_per_1m = EXCLUDED.output_cost_per_1m;
