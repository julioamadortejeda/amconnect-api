-- ─── 1. Crear Tabla centralizada tokens_usage ───
create table tokens_usage (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             uuid not null references agents(id) on delete cascade,
  session_id           uuid references ai_sessions(id) on delete cascade,
  document_metadata_id uuid references document_metadata(id) on delete cascade,
  note_id              uuid references agent_notes(id) on delete cascade,
  source               text not null, -- 'chat_text', 'chat_voice', 'extraction', 'embedding', 'summary'
  model_name           text not null references ai_models(model_name),
  prompt_tokens        int not null default 0,
  completion_tokens    int not null default 0,
  total_tokens         int not null default 0,
  cached_tokens        int not null default 0,
  created_at           timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table tokens_usage enable row level security;

create policy "agent_own_tokens_usage" on tokens_usage
  for all using (agent_id = auth.uid());

create index idx_tokens_usage_agent    on tokens_usage(agent_id);
create index idx_tokens_usage_session  on tokens_usage(session_id);
create index idx_tokens_usage_doc      on tokens_usage(document_metadata_id);
create index idx_tokens_usage_note     on tokens_usage(note_id);

-- ─── 2. Migrar datos históricos ───

-- 2a. Migrar mensajes de chat individuales (chat de texto)
insert into tokens_usage (agent_id, session_id, source, model_name, prompt_tokens, completion_tokens, total_tokens, created_at)
select 
  m.agent_id,
  m.session_id,
  'chat_text',
  coalesce(s.model_name, 'gemini-3.1-flash-lite'),
  m.prompt_tokens,
  m.completion_tokens,
  m.total_tokens,
  m.created_at
from ai_chat_messages m
join ai_sessions s on s.id = m.session_id
where m.total_tokens > 0;

-- 2b. Migrar de la tabla vieja ai_ingestion_usage
insert into tokens_usage (agent_id, session_id, document_metadata_id, source, model_name, prompt_tokens, completion_tokens, total_tokens, cached_tokens, created_at)
select 
  agent_id,
  session_id,
  document_metadata_id,
  operation,
  model_name,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  coalesce(cached_tokens, 0),
  created_at
from ai_ingestion_usage;

-- 2c. Migrar consumos acumulados de voz anteriores (sesiones de voz donde no guardábamos tokens por mensaje)
insert into tokens_usage (agent_id, session_id, source, model_name, prompt_tokens, completion_tokens, total_tokens, created_at)
select 
  s.agent_id,
  s.id,
  'chat_voice',
  coalesce(s.model_name, 'gemini-live-2.5-flash-native-audio'),
  s.prompt_tokens,
  s.completion_tokens,
  s.total_tokens,
  s.created_at
from ai_sessions s
where s.total_tokens > 0 
  and not exists (
    select 1 from ai_chat_messages m 
    where m.session_id = s.id and m.total_tokens > 0
  );

-- ─── 3. Limpiar columnas y tablas antiguas ───

-- Borrar tabla vieja de ingesta
drop table if exists ai_ingestion_usage;

-- Eliminar columnas de tokens de ai_chat_messages
alter table ai_chat_messages
  drop column if exists prompt_tokens,
  drop column if exists completion_tokens,
  drop column if exists total_tokens;

-- Eliminar columnas de tokens de ai_sessions
alter table ai_sessions
  drop column if exists prompt_tokens,
  drop column if exists completion_tokens,
  drop column if exists total_tokens,
  drop column if exists extraction_prompt_tokens,
  drop column if exists extraction_completion_tokens,
  drop column if exists extraction_total_tokens,
  drop column if exists extraction_cached_tokens,
  drop column if exists embedding_total_tokens,
  drop column if exists embedding_count;
