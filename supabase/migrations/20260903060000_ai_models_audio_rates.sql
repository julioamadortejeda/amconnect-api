-- ─── Precio de audio aparte del precio de texto ───────────────────────────────
--
-- `ai_models` tenia UNA tarifa de entrada y UNA de salida, pero los modelos
-- nativos de audio cobran distinto segun la modalidad. Para
-- gemini-live-2.5-flash-native-audio, por 1M de tokens:
--
--   entrada:  $0.50 texto   /  $3.00 audio
--   salida:   $2.00 texto   / $12.00 audio
--
-- El catalogo guardaba 3.00 y 12.00, o sea las tarifas de AUDIO, y `calcCosts`
-- las aplicaba a TODOS los tokens. Como el prompt de voz es casi todo texto
-- —instrucciones del sistema mas las declaraciones de las 43 herramientas, que
-- la Live API reenvia en cada turno— el resultado sobrecobraba de mas.
--
-- Medido en una sesion real de 41 segundos y 6 turnos (2026-09-03):
--
--   texto entrada  23,903 tokens
--   audio entrada   2,119
--   texto salida      180
--   audio salida      508
--
--   cobrado antes:  $0.086322
--   real:           $0.024765     -> 3.5x de mas
--
-- Las columnas de desglose (`text_prompt_tokens`, `audio_prompt_tokens` y sus
-- gemelas de salida) ya existian y ya se llenaban bien: lo unico que faltaba
-- era el precio. Nada de reprocesar historico — las filas viejas de
-- tokens_usage siguen ahi y el desglose tambien, asi que el reporte se corrige
-- solo hacia atras.
--
-- Los modelos que NO son de audio dejan las columnas en NULL, y `calcCosts` cae
-- a la tarifa de texto: para ellos no hay dos precios y no debe haberlos.

alter table ai_models
  add column if not exists audio_input_cost_per_1m  numeric(12,6),
  add column if not exists audio_output_cost_per_1m numeric(12,6);

comment on column ai_models.audio_input_cost_per_1m is
  'Precio por 1M de tokens de audio de ENTRADA. NULL = el modelo no distingue modalidad y se usa input_cost_per_1m.';
comment on column ai_models.audio_output_cost_per_1m is
  'Precio por 1M de tokens de audio de SALIDA. NULL = se usa output_cost_per_1m.';

-- El live nativo: input_cost/output_cost pasan a ser las tarifas de TEXTO, que
-- es lo que siempre debieron significar, y el audio se va a sus columnas.
update ai_models
set input_cost_per_1m        = 0.50,
    output_cost_per_1m       = 2.00,
    audio_input_cost_per_1m  = 3.00,
    audio_output_cost_per_1m = 12.00
where model_name = 'gemini-live-2.5-flash-native-audio';

do $amc$
begin
  if not exists (
    select 1 from ai_models
    where model_name = 'gemini-live-2.5-flash-native-audio'
      and audio_output_cost_per_1m = 12.00
  ) then
    raise exception 'ai_models: no se actualizaron las tarifas de gemini-live-2.5-flash-native-audio';
  end if;
end $amc$;
