-- ─── Usage tracking por mensaje ──────────────────────────────────────────────

alter table ai_chat_messages
  add column prompt_tokens     int not null default 0,
  add column completion_tokens int not null default 0,
  add column total_tokens      int not null default 0;

-- content puede ser null para rows de roles internos (classify)
alter table ai_chat_messages
  alter column content drop not null;

-- ─── Usage acumulado y estado en sesión ───────────────────────────────────────

alter table ai_sessions
  add column prompt_tokens     int not null default 0,
  add column completion_tokens int not null default 0,
  add column total_tokens      int not null default 0,
  add column status            text not null default 'active';

alter table ai_sessions
  add constraint ai_sessions_status_check
  check (status in ('active', 'cancelled'));

-- ─── Incremento atómico de usage para evitar race conditions ─────────────────

create or replace function increment_session_usage(
  p_session_id        uuid,
  p_prompt_tokens     int,
  p_completion_tokens int,
  p_total_tokens      int
) returns void language sql as $$
  update ai_sessions
  set
    prompt_tokens     = prompt_tokens     + p_prompt_tokens,
    completion_tokens = completion_tokens + p_completion_tokens,
    total_tokens      = total_tokens      + p_total_tokens,
    updated_at        = now()
  where id = p_session_id;
$$;
