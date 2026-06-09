-- 1. Rename session_type → type
alter table ai_sessions rename column session_type to type;

-- 2. Add is_billable flag (default true; set false on provider errors)
alter table ai_sessions
  add column if not exists is_billable boolean not null default true;

-- 3. Extend status check to include 'failed' and 'provider_error'
alter table ai_sessions
  drop constraint if exists ai_sessions_status_check;

alter table ai_sessions
  add constraint ai_sessions_status_check
  check (status in ('active', 'cancelled', 'failed', 'provider_error'));

