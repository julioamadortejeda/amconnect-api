-- ─── Catálogo de modelos de IA con tarifas ────────────────────────────────────

create table ai_models (
  model_name         text primary key,
  provider           text not null,           -- 'gemini_api' | 'vertex_ai'
  display_name       text,
  input_cost_per_1m  numeric(12,6) not null default 0,  -- USD por millón tokens input
  output_cost_per_1m numeric(12,6) not null default 0,  -- USD por millón tokens output (0 para embeddings)
  is_active          boolean not null default true
);

insert into ai_models (model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m) values
  ('gemini-3.5-flash',   'gemini_api', 'Gemini 3.5 Flash',   0.075, 0.300),
  ('gemini-embedding-2', 'gemini_api', 'Gemini Embedding 2', 0.000, 0.000);

-- ─── Extender ai_sessions con modelo usado y acumulados de ingesta ────────────

alter table ai_sessions
  add column model_name                   text references ai_models(model_name),
  add column embedding_model_name         text references ai_models(model_name),
  add column extraction_prompt_tokens     int not null default 0,
  add column extraction_completion_tokens int not null default 0,
  add column extraction_total_tokens      int not null default 0,
  add column embedding_total_tokens       int not null default 0,
  add column embedding_count              int not null default 0;

-- ─── Tabla de auditoría por operación de ingesta ──────────────────────────────
-- Una row por operación (extraction | embedding) por ingesta.
-- session_id es null para knowledge ingestion (no crea sesión de chat).

create table ai_ingestion_usage (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             uuid not null references agents(id),
  session_id           uuid references ai_sessions(id),
  document_metadata_id uuid references document_metadata(id),
  operation            text not null check (operation in ('extraction', 'embedding')),
  model_name           text not null references ai_models(model_name),
  prompt_tokens        int not null default 0,
  completion_tokens    int not null default 0,
  total_tokens         int not null default 0,
  item_count           int,   -- número de chunks para 'embedding'
  created_at           timestamptz not null default now()
);

alter table ai_ingestion_usage enable row level security;

create policy "agent_own_ingestion_usage" on ai_ingestion_usage
  for all using (agent_id = auth.uid());

create index idx_ai_ingestion_usage_agent   on ai_ingestion_usage(agent_id);
create index idx_ai_ingestion_usage_session on ai_ingestion_usage(session_id);
