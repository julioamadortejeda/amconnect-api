-- ─── Búsqueda vectorial de notas (RAG) ───────────────────────────────────────

create or replace function search_agent_notes(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.7,
  p_match_count     int   default 5
)
returns table (
  id          uuid,
  content     text,
  contact_id  uuid,
  policy_id   uuid,
  metadata    jsonb,
  similarity  float
)
language sql stable
as $$
  select
    n.id,
    n.content,
    n.contact_id,
    n.policy_id,
    n.metadata,
    1 - (n.embedding <=> p_query_embedding) as similarity
  from agent_notes_vectors n
  where
    n.agent_id = p_agent_id
    and 1 - (n.embedding <=> p_query_embedding) >= p_match_threshold
  order by n.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ─── Búsqueda fuzzy en catálogos (pg_trgm) ────────────────────────────────────

create or replace function search_catalog(
  p_table_name text,
  p_query      text,
  p_threshold  float default 0.3
)
returns table (
  id         uuid,
  name       text,
  similarity float
)
language plpgsql stable
as $$
begin
  return query execute format(
    'select id, name, similarity(name, %L) as similarity
     from %I
     where similarity(name, %L) >= %s
       and is_active = true
     order by similarity desc
     limit 10',
    p_query, p_table_name, p_query, p_threshold
  );
end;
$$;

-- ─── Búsqueda fuzzy de contactos ──────────────────────────────────────────────

create or replace function search_contacts(
  p_agent_id  uuid,
  p_query     text,
  p_threshold float default 0.2
)
returns table (
  id          uuid,
  full_name   text,
  email       text,
  phone       text,
  similarity  float
)
language sql stable
as $$
  select
    id,
    full_name,
    email,
    phone,
    greatest(
      similarity(full_name, p_query),
      similarity(coalesce(email, ''), p_query)
    ) as similarity
  from contacts
  where
    agent_id = p_agent_id
    and is_active = true
    and deleted_at is null
    and greatest(
      similarity(full_name, p_query),
      similarity(coalesce(email, ''), p_query)
    ) >= p_threshold
  order by similarity desc
  limit 10;
$$;

-- ─── Trigger: updated_at automático ──────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create trigger trg_policies_updated_at
  before update on policies
  for each row execute function set_updated_at();

create trigger trg_reminders_updated_at
  before update on reminders
  for each row execute function set_updated_at();

create trigger trg_agents_updated_at
  before update on agents
  for each row execute function set_updated_at();

create trigger trg_ai_sessions_updated_at
  before update on ai_sessions
  for each row execute function set_updated_at();

create trigger trg_ai_pending_tasks_updated_at
  before update on ai_pending_tasks
  for each row execute function set_updated_at();
