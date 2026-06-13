-- Track cached tokens for chat, extraction and ingestion usage.
-- Cached tokens cost ~90% less than regular input tokens (cache_read_cost_per_1m).

alter table ai_sessions
  add column cached_tokens             int not null default 0,
  add column extraction_cached_tokens  int not null default 0;

alter table ai_ingestion_usage
  add column cached_tokens  int not null default 0;

alter table ai_models
  add column cache_read_cost_per_1m  numeric(12,6) not null default 0;

-- gemini-3.1-flash-lite: cache reads at $0.025/M tokens (10% of $0.25 input price)
update ai_models
set cache_read_cost_per_1m = 0.025000
where model_name = 'gemini-3.1-flash-lite';
