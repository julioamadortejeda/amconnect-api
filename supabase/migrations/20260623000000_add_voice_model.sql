-- Registrar el modelo de audio nativo de Gemini en el catálogo de modelos de IA
-- para evitar violaciones de clave foránea en la tabla ai_sessions.
-- Precios estimados para audio multimodal nativo: entrada $3.00/1M, salida $12.00/1M

insert into ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m)
values (
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini_api',
  'Gemini 2.5 Flash Native Audio',
  3.000000,
  12.000000
)
on conflict (model_name) do nothing;
