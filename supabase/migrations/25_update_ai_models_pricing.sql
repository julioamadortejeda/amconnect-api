-- Precios actualizados según Google Cloud pricing (vigentes desde 2026-01-05)
-- Fuente: cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
-- Precios globales en USD por millón de tokens

update ai_models set
  input_cost_per_1m  = 1.500,
  output_cost_per_1m = 9.000
where model_name = 'gemini-3.5-flash';

-- gemini-embedding-2: precio no publicado en la página consultada — mantiene 0.000 hasta confirmación

insert into ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m) values
  ('gemini-3.1-flash-lite', 'gemini_api', 'Gemini 3.1 Flash Lite', 0.250, 1.500);
