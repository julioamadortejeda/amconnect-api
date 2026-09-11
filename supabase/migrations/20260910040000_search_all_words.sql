-- Buscar por VARIAS palabras, en cualquier orden.
--
-- Las funciones anteriores hacían un solo `like '%frase%'`: la frase tenía que
-- aparecer completa y en ese orden. "banamex llamar" no encontraba "Llamar a
-- Banamex", y el asesor concluía que no existía. Es el mismo fallo silencioso
-- de los acentos, una capa más arriba.
--
-- Ahora se parte la consulta en palabras y se exigen TODAS, sin importar el
-- orden ni dónde caiga cada una: título y descripción se concatenan y se busca
-- sobre el conjunto, así que "julio diagnostico" encuentra un recordatorio que
-- se llama "Sesión de diagnóstico" y menciona a Julio en la descripción.
--
-- `bool_and` sobre cero palabras devuelve null, de ahí el coalesce: una
-- consulta vacía no debe filtrar nada en vez de no devolver nada.

create or replace function search_reminder_ids(
  p_agent_id uuid,
  p_query    text
)
returns setof uuid
language sql stable
as $$
  select r.id
  from reminders r
  where r.agent_id = p_agent_id
    and r.is_active
    and coalesce((
      select bool_and(
        unaccent(lower(coalesce(r.title, '') || ' ' || coalesce(r.description, '')))
          like '%' || unaccent(lower(palabra)) || '%'
      )
      from unnest(string_to_array(trim(p_query), ' ')) as palabra
      where palabra <> ''
    ), true);
$$;

create or replace function search_commitment_ids(
  p_agent_id uuid,
  p_query    text
)
returns setof uuid
language sql stable
as $$
  select c.id
  from client_commitments c
  where c.agent_id = p_agent_id
    and c.is_active
    and coalesce((
      select bool_and(
        unaccent(lower(coalesce(c.label, '') || ' ' || coalesce(c.quote, '')))
          like '%' || unaccent(lower(palabra)) || '%'
      )
      from unnest(string_to_array(trim(p_query), ' ')) as palabra
      where palabra <> ''
    ), true);
$$;

grant execute on function search_reminder_ids(uuid, text)   to authenticated;
grant execute on function search_commitment_ids(uuid, text) to authenticated;
