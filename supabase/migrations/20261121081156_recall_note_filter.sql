-- `recall` con `note_id`: búsqueda dentro de UN documento (D-013, "más de este
-- documento"). Agrega `p_note_id` a las dos funciones de 20261121074654_recall_search
-- (esa migración ya está aplicada y no se toca): se recrean con el parámetro al
-- final, con default null. Todo lo demás es idéntico. Security invoker: el RLS de
-- agent_notes / agent_note_chunks sigue aplicando, así que un note_id de otro
-- asesor no devuelve nada.
--
-- Limitación conocida de recall_tsquery (sin cambio de comportamiento): descarta
-- una palabra si la quita CUALQUIERA de las dos configuraciones, spanish o
-- english. Una palabra vacía de un idioma que además es palabra real del otro
-- ("once", número en español y palabra vacía en inglés) se descarta de la
-- búsqueda de texto. La vectorial no se ve afectada y cubre ese caso.

comment on function recall_tsquery(text) is
  'OR de términos [a-z0-9] sin palabras vacías de spanish NI de english. Limitación: una palabra vacía en un idioma que es palabra real en el otro (p. ej. "once") se descarta; la búsqueda vectorial lo cubre.';

drop function search_agent_note_chunks_exact(uuid, vector, float, int, text[], uuid, uuid, uuid);
drop function search_agent_note_chunks_text(uuid, text, int, text[], uuid, uuid, uuid);

create function search_agent_note_chunks_exact(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.4,
  p_match_count     int   default 50,
  p_source_types    text[] default null,
  p_contact_id      uuid  default null,
  p_policy_id       uuid  default null,
  p_reminder_id     uuid  default null,
  p_note_id         uuid  default null
)
returns table (
  chunk_id    uuid,
  note_id     uuid,
  content     text,
  similarity  float,
  contact_id  uuid,
  policy_id   uuid,
  reminder_id uuid,
  source_type text,
  created_at  timestamptz
)
language sql stable
as $$
  select
    c.id as chunk_id,
    c.note_id,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    n.contact_id,
    n.policy_id,
    n.reminder_id,
    n.source_type,
    n.created_at
  from agent_note_chunks c
  join agent_notes n on n.id = c.note_id
  where c.agent_id = p_agent_id
    and n.is_active = true
    and (p_note_id is null or c.note_id = p_note_id)
    and (p_source_types is null or n.source_type = any (p_source_types))
    and (p_contact_id  is null or n.contact_id  = p_contact_id)
    and (p_policy_id   is null or n.policy_id   = p_policy_id)
    and (p_reminder_id is null or n.reminder_id = p_reminder_id)
    and 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  order by c.embedding <=> p_query_embedding, c.id
  limit p_match_count;
$$;

create function search_agent_note_chunks_text(
  p_agent_id     uuid,
  p_query        text,
  p_match_count  int   default 50,
  p_source_types text[] default null,
  p_contact_id   uuid  default null,
  p_policy_id    uuid  default null,
  p_reminder_id  uuid  default null,
  p_note_id      uuid  default null
)
returns table (
  chunk_id    uuid,
  note_id     uuid,
  content     text,
  similarity  float,
  contact_id  uuid,
  policy_id   uuid,
  reminder_id uuid,
  source_type text,
  created_at  timestamptz
)
language sql stable
set search_path = public, extensions
as $$
  with q as (select recall_tsquery(p_query) as tsq)
  select
    c.id as chunk_id,
    c.note_id,
    c.content,
    ts_rank_cd(to_tsvector('simple', immutable_unaccent(c.content)), q.tsq)::float as similarity,
    n.contact_id,
    n.policy_id,
    n.reminder_id,
    n.source_type,
    n.created_at
  from q, agent_note_chunks c
  join agent_notes n on n.id = c.note_id
  where q.tsq is not null
    and c.agent_id = p_agent_id
    and n.is_active = true
    and to_tsvector('simple', immutable_unaccent(c.content)) @@ q.tsq
    and (p_note_id is null or c.note_id = p_note_id)
    and (p_source_types is null or n.source_type = any (p_source_types))
    and (p_contact_id  is null or n.contact_id  = p_contact_id)
    and (p_policy_id   is null or n.policy_id   = p_policy_id)
    and (p_reminder_id is null or n.reminder_id = p_reminder_id)
  order by 4 desc, c.id
  limit p_match_count;
$$;

revoke execute on function search_agent_note_chunks_exact(uuid, vector, float, int, text[], uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function search_agent_note_chunks_text(uuid, text, int, text[], uuid, uuid, uuid, uuid) from public, anon;
grant execute on function search_agent_note_chunks_exact(uuid, vector, float, int, text[], uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function search_agent_note_chunks_text(uuid, text, int, text[], uuid, uuid, uuid, uuid) to authenticated, service_role;
