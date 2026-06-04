-- ─── Sesiones de conversación ─────────────────────────────────────────────────

create table ai_sessions (
  id               uuid primary key default uuid_generate_v4(),
  agent_id         uuid not null references agents(id) on delete cascade,
  trigger_message  text,        -- primer mensaje que inició la sesión
  history          jsonb,       -- array de AiMessage para re-alimentar al modelo
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_ai_sessions_agent_id on ai_sessions(agent_id);

-- ─── Mensajes del chat (historial visible en UI) ──────────────────────────────

create table ai_chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  session_id  uuid not null references ai_sessions(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  role        text not null,    -- 'user' | 'model'
  content     text not null,
  created_at  timestamptz not null default now()
);

create index idx_ai_chat_messages_session_id on ai_chat_messages(session_id);

-- ─── Notas del asesor embebidas para RAG ─────────────────────────────────────
-- Cada nota es un fragmento de texto + su embedding vectorial

create table agent_notes_vectors (
  id          uuid primary key default uuid_generate_v4(),
  agent_id    uuid not null references agents(id) on delete cascade,
  contact_id  uuid references contacts(id),
  policy_id   uuid references policies(id),
  content     text not null,           -- texto de la nota
  embedding   vector(768),             -- text-embedding-004 genera 768 dims
  metadata    jsonb,                   -- datos extra (source, tipo, etc.)
  created_at  timestamptz not null default now()
);

create index idx_agent_notes_agent_id on agent_notes_vectors(agent_id);
create index idx_agent_notes_contact_id on agent_notes_vectors(contact_id);
-- Índice vectorial para búsqueda por similitud coseno
create index idx_agent_notes_embedding on agent_notes_vectors
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── Tareas pendientes del AI (confirmación del usuario) ──────────────────────

create table ai_pending_tasks (
  id          uuid primary key default uuid_generate_v4(),
  session_id  uuid not null references ai_sessions(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  task_type   text not null,    -- 'create_contact' | 'create_policy' | 'create_reminder'
  payload     jsonb not null,   -- datos extraídos listos para confirmar
  status      text not null default 'pending',  -- 'pending' | 'confirmed' | 'rejected'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
