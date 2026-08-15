-- Actualizar precios de gemini-3.1-flash-live-preview según tarifas oficiales de Google AI Studio (Audio)
-- Entrada de audio: $3.00 USD por millón de tokens
-- Salida de audio: $12.00 USD por millón de tokens
UPDATE ai_models
SET
  input_cost_per_1m = 3.000000,
  output_cost_per_1m = 12.000000
WHERE model_name = 'gemini-3.1-flash-live-preview';
