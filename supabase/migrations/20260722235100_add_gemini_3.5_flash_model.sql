-- Agregar o reactivar gemini-3.5-flash en el catálogo de modelos
insert into ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m, cache_read_cost_per_1m, is_active)
values ('gemini-3.5-flash', 'gemini_api', 'Gemini 3.5 Flash', 1.500000, 9.000000, 0.150000, true)
on conflict (model_name) do update
  set is_active = true,
      input_cost_per_1m = excluded.input_cost_per_1m,
      output_cost_per_1m = excluded.output_cost_per_1m,
      cache_read_cost_per_1m = excluded.cache_read_cost_per_1m;
