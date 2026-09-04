-- ─── search_contacts: buscar por PALABRA y sin acentos ────────────────────────
--
-- La rama fuzzy usaba `similarity(full_name, query)`, que compara el nombre
-- COMPLETO contra lo que el asesor escribió. Buscar por nombre de pila a un
-- cliente con dos apellidos diluye el puntaje hasta debajo del umbral, y el
-- fallo es SILENCIOSO: el asistente contesta "no encontré a ninguna clienta
-- llamada María" con toda confianza y el asesor le cree.
--
-- Medido en datos reales (2026-08-28), umbral viejo 0.2:
--
--   'María de los Ángeles Muñoz' vs 'Maria'  -> 0.103  NO PASA
--   'María de los Ángeles Muñoz' vs 'María'  -> 0.231  pasa raspando
--   'Julio César Amador Tejeda'  vs 'Julio'  -> 0.231  pasa por 3 centésimas
--
-- Se apilan dos cosas: el acento (í ≠ i) y la longitud del nombre. Un apellido
-- más y Julio también desaparecía.
--
-- El arreglo son dos piezas:
--
--   1. `word_similarity(query, nombre)` compara contra la MEJOR PALABRA del
--      nombre en vez de contra todo, así que dejan de importar los apellidos.
--   2. `unaccent()` a los dos lados, así que da igual cómo lo escriba el asesor.
--
-- Con eso, los mismos casos: Maria -> 1.000, María -> 1.000, Julio -> 1.000.
--
-- El umbral sube 0.2 -> 0.5 porque la escala de word_similarity es otra: con
-- 0.2 entraba basura ('juan' pegaba 0.40 con 'Julio'). Verificado con 14
-- consultas — 'juan' y 'pedro' devuelven nada, y 'mar', 'amador', 'tejeda',
-- 'sosa', 'maria munoz' devuelven a quien deben. El default vive AQUÍ y el
-- código TypeScript ya no lo manda: el número es propiedad de la escala de la
-- función, no de quien la llama.
--
-- Las consultas de menos de 3 caracteres se quedan solo con el match exacto:
-- 'a' pega 0.50 con todo el portafolio y eso no es una búsqueda, es ruido.
--
-- Nota de índice: `idx_contacts_full_name_trgm` no cubre `unaccent(full_name)`.
-- No se agrega uno nuevo porque la consulta filtra primero por `agent_id`
-- (que sí tiene índice) y un asesor tiene cientos de contactos, no millones.
--
-- Ojo: `similarity()` y `word_similarity()` devuelven `real`. El cast a
-- `::float` NO es decorativo — sin él revienta con "structure of query does not
-- match function result type", que es justo lo que arregló
-- 20260801230114_fix_search_functions_type_mismatch.sql.

create extension if not exists unaccent;

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
  -- Match exacto primero (ver 20260731040241): si el asesor escribió el nombre
  -- o el correo tal cual, no hay nada que adivinar.
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
end;
$$;
