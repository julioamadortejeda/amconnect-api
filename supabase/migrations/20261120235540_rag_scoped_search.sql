-- RAG correcto (revisión del motor de IA 2026-11, §1.2, §1.3, §1.4 y §1.7).
--
-- 1. search_agent_note_chunks filtra por contacto / póliza / recordatorio ANTES
--    del LIMIT. Antes el repositorio aplicaba `.eq(...)` sobre el resultado de la
--    RPC, que ya había recortado a los N fragmentos más parecidos de TODO el
--    asesor: si esos N eran de otros clientes, la búsqueda acotada volvía vacía
--    aunque el cliente sí tuviera el documento.
-- 2. La función devuelve `reminder_id`. Sin esa columna, el `.eq("reminder_id")`
--    de search_reminder_notes fallaba siempre en PostgREST (42703).
-- 3. Índice vectorial HNSW en lugar de ivfflat (lists = 100 creado con la tabla
--    vacía y probes = 1 se salta vecinos reales). Se usa vector_cosine_ops porque
--    la función ordena por `<=>` (distancia coseno).
-- 4. insert_agent_note_with_chunks: nota + fragmentos en una sola transacción.
--    Es un RPC justificado (RULES §6): TypeScript no da transacciones con
--    supabase-js, y sin esto un fallo al insertar los fragmentos dejaba una nota
--    guardada que nunca aparece en una búsqueda.
--
-- Compatibilidad con la Edge Function desplegada antes de esta migración: los
-- parámetros nuevos tienen default null, así que la llamada vieja de 4
-- argumentos sigue resolviendo (PostgREST resuelve por nombre) y su `.eq(...)`
-- posterior sigue funcionando — ahora también el de reminder_id.

-- ─── 1 y 2. Búsqueda acotada ─────────────────────────────────────────────────

drop function if exists search_agent_note_chunks(uuid, vector, float, int);

create function search_agent_note_chunks(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.7,
  p_match_count     int   default 5,
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
-- security invoker (default): el RLS de agent_notes / agent_note_chunks
-- (agent_id = auth.uid()) sigue aplicando además del filtro por p_agent_id.
as $$
  select
    c.id        as chunk_id,
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
    and (p_contact_id  is null or n.contact_id  = p_contact_id)
    and (p_policy_id   is null or n.policy_id   = p_policy_id)
    and (p_reminder_id is null or n.reminder_id = p_reminder_id)
    and 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

revoke execute on function search_agent_note_chunks(uuid, vector, float, int, uuid, uuid, uuid) from public, anon;
grant  execute on function search_agent_note_chunks(uuid, vector, float, int, uuid, uuid, uuid) to authenticated, service_role;

-- ─── 3. Índice HNSW ──────────────────────────────────────────────────────────

drop index if exists idx_agent_note_chunks_embedding;

create index idx_agent_note_chunks_embedding on agent_note_chunks
  using hnsw (embedding vector_cosine_ops);

-- El índice es global (todos los asesores) y HNSW filtra DESPUÉS de recorrer
-- `hnsw.ef_search` candidatos (40 por defecto). Sin escaneo iterativo, los
-- filtros por asesor/contacto/póliza/recordatorio volverían a perder resultados,
-- igual que el bug que esta migración corrige. Con `strict_order` (pgvector
-- 0.8+) el índice sigue entregando candidatos en orden exacto hasta llenar el
-- LIMIT. Se aplica solo si la versión instalada de pgvector lo soporta, para
-- que la migración no truene en un entorno con pgvector < 0.8.
do $$
begin
  perform '[1]'::vector;  -- carga la librería para que sus GUC existan en esta sesión
  if exists (select 1 from pg_settings where name = 'hnsw.iterative_scan') then
    execute 'alter function search_agent_note_chunks(uuid, vector, float, int, uuid, uuid, uuid) '
            'set hnsw.iterative_scan = strict_order';
  else
    raise warning 'pgvector without hnsw.iterative_scan: filtered RAG searches may miss results once the index is used';
  end if;
end;
$$;

-- ─── 4. Nota + fragmentos en una transacción ─────────────────────────────────

-- p_chunks: [{ "chunk_index": int, "content": text, "embedding": [float, ...] }]
-- security invoker: el RLS (agent_id = auth.uid()) valida que el asesor solo
-- escriba lo suyo; con service_role no aplica, igual que el insert directo.
create function insert_agent_note_with_chunks(
  p_agent_id             uuid,
  p_contact_id           uuid,
  p_policy_id            uuid,
  p_reminder_id          uuid,
  p_source_type          text,
  p_content              text,
  p_document_metadata_id uuid,
  p_note_origin          text,
  p_summary              text,
  p_chunks               jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_note_id uuid;
begin
  insert into agent_notes (
    agent_id, contact_id, policy_id, reminder_id, source_type, content,
    document_metadata_id, note_origin, summary
  ) values (
    p_agent_id, p_contact_id, p_policy_id, p_reminder_id, p_source_type, p_content,
    p_document_metadata_id, coalesce(p_note_origin, 'knowledge'), p_summary
  )
  returning id into v_note_id;

  insert into agent_note_chunks (note_id, agent_id, chunk_index, content, embedding)
  select
    v_note_id,
    p_agent_id,
    (e ->> 'chunk_index')::int,
    e ->> 'content',
    (e -> 'embedding')::text::vector
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as e;

  return v_note_id;
end;
$$;

revoke execute on function insert_agent_note_with_chunks(uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb) from public, anon;
grant  execute on function insert_agent_note_with_chunks(uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb) to authenticated, service_role;
