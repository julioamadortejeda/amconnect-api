-- ─── Tercera rama: buscar por como SUENA ─────────────────────────────────────
--
-- Caso real, sesion de voz del 2026-09-03. El asesor dijo "Zarah" y la
-- transcripcion escribio "Sara". La busqueda comparaba LETRAS:
--
--   word_similarity('Sara', 'ZARAH ITZEL SOSA HERNANDEZ') = 0.200
--
-- Con el umbral en 0.5 eso es cero resultados, y el asistente contesto "no
-- encontre a Sara en tus contactos, ¿la agrego como prospecto?" — a punto de
-- crear un duplicado de una clienta que si existe. Por voz duele el doble: no
-- hay tarjeta de contactos que mirar y corregirlo obliga a deletrear ("es
-- Sarah con Z al inicio").
--
-- Ninguna de las dos ramas actuales puede resolverlo: la exacta pide identidad
-- y los trigramas comparan cadenas de letras. Se agrega una TERCERA que compara
-- fonemas con dmetaphone (extension fuzzystrmatch, en Postgres desde siempre;
-- no es un modelo ni un servicio externo, es una tabla de reglas determinista).
--
--   dmetaphone('Sara') = dmetaphone('Zarah') = 'SR'
--
-- Palabra contra palabra en LOS DOS lados, no la frase entera: asi "Julio
-- Cesar" encuentra a Julio Cesar Amador Tejeda, y "la señora Sara" encuentra a
-- Zarah. Comparar frases completas fallaba en cuanto sobraba una palabra.
--
-- SOLO corre cuando las otras dos devolvieron NADA. Es un ultimo recurso, no un
-- ensanchamiento: un resultado que hoy funciona no cambia. Por eso tampoco hay
-- que reprobar lo que ya se probo con la version anterior.
--
-- Medido contra los contactos reales antes de escribir esto:
--
--   Sara / Sarah / Zara / Sosa      -> ZARAH ITZEL SOSA HERNANDEZ
--   Maria / Maria de los angeles    -> Maria de los Angeles Muñoz
--   Julio / Julio Cesar / Amador    -> los dos Julios
--   la señora Sara                  -> ZARAH
--   Juan Perez / Pedro / Carlos     -> nada
--   Laura / Rosa                    -> nada
--
-- Cero falsos positivos. 'Rosa' vs 'Sosa' era la duda grande y no pegan: RS
-- contra SS.
--
-- Limites conocidos, a proposito sin tapar:
--   - dmetaphone esta afinado para ingles. En español acierta por parecido
--     fonetico general, pero no esta garantizado en apellidos poco comunes.
--   - Solo rescata nombres que SUENAN parecido. Si la transcripcion oye algo
--     sin relacion fonetica, no hay nada que hacer aqui.
--   - Palabras de menos de 3 letras se ignoran: 'de', 'la', 'los' colapsan con
--     medio mundo y meterian ruido.
--
-- La similitud se reporta como 0.45: por debajo del umbral de los trigramas, a
-- proposito. Es un match mas debil y quien lea el resultado debe poder notarlo.

create extension if not exists fuzzystrmatch;

create or replace function search_contacts(
  p_agent_id  uuid,
  p_query     text,
  p_threshold float default 0.5
)
returns table (
  id          uuid,
  full_name   text,
  email       text,
  phone       text,
  similarity  float
)
language plpgsql stable
as $$
begin
  -- 1) Exacto (20260731040241): si lo escribio tal cual, no hay nada que adivinar.
  return query
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    1.0::float as similarity
  from contacts c
  where
    c.agent_id = p_agent_id
    and c.is_active = true
    and c.deleted_at is null
    and (
      unaccent(lower(c.full_name)) = unaccent(lower(p_query))
      or lower(coalesce(c.email, '')) = lower(p_query)
    );

  if found then
    return;
  end if;

  if length(btrim(coalesce(p_query, ''))) < 3 then
    return;
  end if;

  -- 2) Trigramas por palabra (20260828130000): tolera apellidos de mas y acentos.
  return query
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    greatest(
      word_similarity(unaccent(p_query), unaccent(c.full_name)),
      word_similarity(unaccent(p_query), unaccent(coalesce(c.email, '')))
    )::float as similarity
  from contacts c
  where
    c.agent_id = p_agent_id
    and c.is_active = true
    and c.deleted_at is null
    and greatest(
      word_similarity(unaccent(p_query), unaccent(c.full_name)),
      word_similarity(unaccent(p_query), unaccent(coalesce(c.email, '')))
    ) >= p_threshold
  order by similarity desc
  limit 10;

  if found then
    return;
  end if;

  -- 3) Fonetico. Ultimo recurso, solo si las dos anteriores no dieron nada.
  return query
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    0.45::float as similarity
  from contacts c
  where
    c.agent_id = p_agent_id
    and c.is_active = true
    and c.deleted_at is null
    and exists (
      select 1
      from unnest(string_to_array(unaccent(lower(btrim(p_query))), ' ')) as qw
      join unnest(string_to_array(unaccent(lower(c.full_name)), ' ')) as nw
        on dmetaphone(qw) = dmetaphone(nw)
      where length(qw) >= 3
        and length(nw) >= 3
        and dmetaphone(qw) <> ''
    )
  order by c.full_name
  limit 10;
end;
$$;
