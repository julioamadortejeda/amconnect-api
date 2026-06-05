-- ─── Agent Notes (header) ────────────────────────────────────────────────────
create table agent_notes (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             uuid not null references agents(id) on delete cascade,
  contact_id           uuid references contacts(id) on delete set null,
  policy_id            uuid references policies(id) on delete set null,
  source_type          text not null check (source_type in ('pdf','image','audio','document','text')),
  storage_path         text,
  ai_content           text,
  document_metadata_id uuid references document_metadata(id) on delete set null,
  metadata             jsonb,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

-- ─── Agent Note Chunks (embeddings) ─────────────────────────────────────────
create table agent_note_chunks (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references agent_notes(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   vector(768),
  created_at  timestamptz not null default now()
);

-- ─── ai_sessions: session_type + metadata ───────────────────────────────────
alter table ai_sessions
  add column if not exists session_type text not null default 'chat',
  add column if not exists metadata jsonb;

-- ─── Índices ─────────────────────────────────────────────────────────────────
create index idx_agent_notes_agent    on agent_notes(agent_id);
create index idx_agent_notes_contact  on agent_notes(contact_id);
create index idx_agent_notes_policy   on agent_notes(policy_id);
create index idx_agent_notes_doc_meta on agent_notes(document_metadata_id);

create index idx_agent_note_chunks_note  on agent_note_chunks(note_id);
create index idx_agent_note_chunks_agent on agent_note_chunks(agent_id);
create index idx_agent_note_chunks_embedding on agent_note_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table agent_notes enable row level security;
alter table agent_note_chunks enable row level security;

create policy "agent_notes: owner"
  on agent_notes for all using (agent_id = auth.uid());

create policy "agent_note_chunks: owner"
  on agent_note_chunks for all using (agent_id = auth.uid());

-- ─── Función de búsqueda vectorial en chunks ─────────────────────────────────
create or replace function search_agent_note_chunks(
  p_agent_id        uuid,
  p_query_embedding vector(768),
  p_match_threshold float default 0.7,
  p_match_count     int   default 5
)
returns table (
  chunk_id    uuid,
  note_id     uuid,
  content     text,
  similarity  float,
  contact_id  uuid,
  policy_id   uuid,
  source_type text,
  metadata    jsonb
)
language sql stable
as $$
  select
    c.id        as chunk_id,
    c.note_id,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    n.contact_id,
    n.policy_id,
    n.source_type,
    n.metadata
  from agent_note_chunks c
  join agent_notes n on n.id = c.note_id
  where c.agent_id = p_agent_id
    and n.is_active = true
    and 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;
