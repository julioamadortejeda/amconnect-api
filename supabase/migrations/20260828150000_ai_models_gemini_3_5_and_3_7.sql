-- Alta de los modelos de reemplazo. Precios de la tabla oficial al 2026-08-28.
--
-- Por qué ahora: `gemini-3.1-flash-lite` tiene fecha de APAGADO, 7 de mayo de
-- 2027, y su reemplazo recomendado por Google es `gemini-3.5-flash-lite`. Es el
-- único de la familia 3.x con fecha anunciada, así que la migración no es
-- opcional — solo se puede hacer temprano o tarde.
--
-- Sin esta fila no se puede ni probar: `AI_MODEL` viene de `requireEnv` y el
-- contenedor DI valida que el modelo de la env exista aquí; cambiar
-- GEMINI_MODEL sin darlo de alta truena al arrancar.
--
-- Costo medido con tráfico real (20 msg/día por asesor):
--   3.1-flash-lite  $1.36/mes    3.5-flash-lite  $1.67/mes    3.7-flash  $4.05/mes
--
-- Se agrega también `gemini-3.7-flash` porque es el siguiente escalón natural
-- si flash-lite no alcanza: es el modelo agéntico de la familia y hoy cuesta la
-- MITAD que `gemini-3.5-flash`, que es más viejo. No se agrega 3.6-flash: mismo
-- precio que el 3.7 y una generación atrás.
--
-- OJO — el precio del 3.7 es introductorio y SE DUPLICA el 1 de enero de 2027
-- ($1.50 / $7.50 / $0.15). Si para entonces sigue en uso, hay que actualizar
-- esta tabla o el reporte de costos va a mentir.

insert into ai_models (model_name, provider, display_name,
                       input_cost_per_1m, output_cost_per_1m, cache_read_cost_per_1m, is_active)
values
  ('gemini-3.5-flash-lite', 'gemini_api', 'Gemini 3.5 Flash Lite', 0.30, 2.50, 0.030, true),
  ('gemini-3.7-flash',      'gemini_api', 'Gemini 3.7 Flash',      0.75, 3.75, 0.075, true)
on conflict (model_name) do update set
  input_cost_per_1m      = excluded.input_cost_per_1m,
  output_cost_per_1m     = excluded.output_cost_per_1m,
  cache_read_cost_per_1m = excluded.cache_read_cost_per_1m,
  display_name           = excluded.display_name,
  is_active              = excluded.is_active;

-- `gemini-3.1-flash-lite` se queda ACTIVO: sigue siendo el modelo en uso y
-- `ai_sessions.model_name` lo referencia por llave foránea. Se desactiva cuando
-- la migración esté hecha, no antes.
