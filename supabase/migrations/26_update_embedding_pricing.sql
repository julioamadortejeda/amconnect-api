-- Gemini Embedding 2: $0.20 por millón de tokens texto (input text $/1M tokens)
-- Fuente: Google Cloud MultiModal Embeddings pricing (Unified Multimodal, Preview)

update ai_models set
  input_cost_per_1m = 0.200
where model_name = 'gemini-embedding-2';
