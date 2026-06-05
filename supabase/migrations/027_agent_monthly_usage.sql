-- ─── Uso mensual por agente ───────────────────────────────────────────────────

create table agent_monthly_usage (
  agent_id        uuid not null references agents(id),
  year_month      date not null,   -- siempre el primer día del mes
  chat_count      int  not null default 0,
  ingestion_count int  not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (agent_id, year_month)
);

alter table agent_monthly_usage enable row level security;

create policy "agent_own_monthly_usage"
  on agent_monthly_usage for all
  using (agent_id = auth.uid());

-- Upsert atómico: crea la fila del mes si no existe, o incrementa el contador.
-- p_field: 'chat' | 'ingestion'
create or replace function increment_monthly_usage(
  p_agent_id uuid,
  p_field    text
) returns void
language sql
security definer set search_path = public
as $$
  insert into agent_monthly_usage (agent_id, year_month, chat_count, ingestion_count)
  values (
    p_agent_id,
    date_trunc('month', now())::date,
    case when p_field = 'chat'      then 1 else 0 end,
    case when p_field = 'ingestion' then 1 else 0 end
  )
  on conflict (agent_id, year_month) do update set
    chat_count      = agent_monthly_usage.chat_count
                      + case when p_field = 'chat'      then 1 else 0 end,
    ingestion_count = agent_monthly_usage.ingestion_count
                      + case when p_field = 'ingestion' then 1 else 0 end,
    updated_at      = now();
$$;
