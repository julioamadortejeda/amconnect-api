-- Drop obsolete comments column from reminders
alter table reminders drop column if exists comments;

-- Create reminder_comments table
create table reminder_comments (
  id           uuid primary key default uuid_generate_v4(),
  reminder_id  uuid not null references reminders(id) on delete cascade,
  agent_id     uuid not null references agents(id) on delete cascade,
  content      text not null,
  created_at   timestamptz not null default now()
);

-- Enable RLS
alter table reminder_comments enable row level security;

-- Policies for security
create policy "reminder_comments: view own"
  on reminder_comments for select
  using (
    exists (
      select 1 from reminders r
      where r.id = reminder_comments.reminder_id
      and r.agent_id = auth.uid()
    )
  );

create policy "reminder_comments: insert own"
  on reminder_comments for insert
  with check (
    exists (
      select 1 from reminders r
      where r.id = reminder_comments.reminder_id
      and r.agent_id = auth.uid()
    )
  );
