-- Búsqueda de `recall` en notas y documentos (D-012, D-013).
--
-- 1. search_agent_note_chunks_exact: búsqueda vectorial EXACTA, sin HNSW.
--    - Filtra por asesor (y contacto / póliza / recordatorio / tipo de fuente)
--      ANTES del LIMIT y ordena por distancia y luego por `id`.
--    - El desempate por `id` es lo que hace estable la paginación: dos
--      fragmentos con la misma distancia siempre salen en el mismo orden, así
--      que `page: 2` no repite ni se salta lo de `page: 1`. Además, un ORDER BY
--      con dos llaves no puede usar el índice HNSW, y eso es lo que se quiere:
--      el HNSW es global (todos los asesores) y aproximado, y su recall baja
--      justo cuando el filtro por asesor descarta casi todo lo que recorre.
--    - Medido el 2026-11-21 en local con 15,000 fragmentos de un solo asesor
--      (aleatorios, peor caso): exacta ≈ 37 ms contra ≈ 300 ms de
--      search_agent_note_chunks con HNSW iterativo.
-- 2. Búsqueda de texto completo (léxica) para términos exactos: "hernia",
--    números de póliza, nombres de aseguradoras. Se combina con la vectorial
--    por RRF en TypeScript (función pura), no aquí.
--    - Configuración 'simple' (sin stemming): el contenido mezcla español e
--      inglés y ninguna de las dos configuraciones sirve para ambos.
--    - `unaccent` no es IMMUTABLE, así que no se puede usar directo en un
--      índice: immutable_unaccent() lo envuelve (el diccionario `unaccent` no
--      cambia en la vida de la BD).
-- Ambas funciones son security invoker: el RLS de agent_notes / agent_note_chunks
-- (agent_id = auth.uid()) aplica además del filtro por p_agent_id.

create or replace function immutable_unaccent(p_text text)
returns text
language sql immutable parallel safe strict
set search_path = public, extensions
as $$
  select unaccent('unaccent'::regdictionary, p_text);
$$;

create index idx_agent_note_chunks_fts on agent_note_chunks
  using gin (to_tsvector('simple', immutable_unaccent(content)));

-- ─── 1. Vectorial exacta ─────────────────────────────────────────────────────

create function search_agent_note_chunks_exact(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.4,
  p_match_count     int   default 50,
  p_source_types    text[] default null,
  p_contact_id      uuid  default null,
  p_policy_id       uuid  default null,
  p_reminder_id     uuid  default null
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
    and (p_source_types is null or n.source_type = any (p_source_types))
    and (p_contact_id  is null or n.contact_id  = p_contact_id)
    and (p_policy_id   is null or n.policy_id   = p_policy_id)
    and (p_reminder_id is null or n.reminder_id = p_reminder_id)
    and 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  order by c.embedding <=> p_query_embedding, c.id
  limit p_match_count;
$$;

-- ─── 2. Texto completo ───────────────────────────────────────────────────────

-- Términos de la consulta unidos con OR. Se descartan las palabras vacías
-- (artículos, preposiciones) comprobando que NINGUNA de las dos configuraciones,
-- spanish y english, las elimine: "de" la quita spanish, "the" la quita english.
-- Los términos son solo [a-z0-9], así que to_tsquery no puede fallar por sintaxis.
create function recall_tsquery(p_query text)
returns tsquery
language sql stable
set search_path = public, extensions
as $$
  select to_tsquery('simple', nullif(string_agg(w, ' | '), ''))
  from (
    select distinct m[1] as w
    from regexp_matches(lower(immutable_unaccent(coalesce(p_query, ''))), '[a-z0-9]+', 'g') as m
    where length(m[1]) >= 2
      and to_tsvector('spanish', m[1]) <> ''::tsvector
      and to_tsvector('english', m[1]) <> ''::tsvector
  ) t;
$$;

create function search_agent_note_chunks_text(
  p_agent_id     uuid,
  p_query        text,
  p_match_count  int   default 50,
  p_source_types text[] default null,
  p_contact_id   uuid  default null,
  p_policy_id    uuid  default null,
  p_reminder_id  uuid  default null
)
returns table (
  chunk_id    uuid,
  note_id     uuid,
  content     text,
  similarity  float,   -- ts_rank_cd: relevancia léxica, NO comparable con el coseno
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
    and (p_source_types is null or n.source_type = any (p_source_types))
    and (p_contact_id  is null or n.contact_id  = p_contact_id)
    and (p_policy_id   is null or n.policy_id   = p_policy_id)
    and (p_reminder_id is null or n.reminder_id = p_reminder_id)
  order by 4 desc, c.id
  limit p_match_count;
$$;

revoke execute on function immutable_unaccent(text) from public, anon;
revoke execute on function recall_tsquery(text) from public, anon;
revoke execute on function search_agent_note_chunks_exact(uuid, vector, float, int, text[], uuid, uuid, uuid) from public, anon;
revoke execute on function search_agent_note_chunks_text(uuid, text, int, text[], uuid, uuid, uuid) from public, anon;
grant execute on function immutable_unaccent(text) to authenticated, service_role;
grant execute on function recall_tsquery(text) to authenticated, service_role;
grant execute on function search_agent_note_chunks_exact(uuid, vector, float, int, text[], uuid, uuid, uuid) to authenticated, service_role;
grant execute on function search_agent_note_chunks_text(uuid, text, int, text[], uuid, uuid, uuid) to authenticated, service_role;
