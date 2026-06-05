-- ─── Planes de suscripción en agents ─────────────────────────────────────────

alter table agents
  add column plan_id                uuid references subscription_plans(id),
  add column subscription_status    text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'expired', 'cancelled')),
  add column trial_ends_at          timestamptz,
  add column subscription_expires_at timestamptz,
  add column promo_code_used        text;

-- Migrar agentes existentes al plan 'consolidado' como activos
update agents
set
  plan_id             = (select id from subscription_plans where slug = 'consolidado'),
  subscription_status = 'active'
where plan_id is null;

-- ─── Promo codes para early adopters ─────────────────────────────────────────

create table promo_codes (
  id                        uuid primary key default uuid_generate_v4(),
  code                      text unique not null,
  trial_days                int not null default 14,
  first_month_discount_pct  int not null default 0 check (first_month_discount_pct between 0 and 100),
  max_uses                  int,          -- null = ilimitado
  used_count                int not null default 0,
  expires_at                timestamptz,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now()
);

-- Solo accesible via service role (no exponer al frontend)
alter table promo_codes enable row level security;

-- ─── Columnas adicionales en document_metadata ───────────────────────────────

alter table document_metadata
  add column contact_id      uuid references contacts(id),
  add column ingestion_type  text not null default 'pdf'
    check (ingestion_type in ('pdf', 'image', 'audio', 'whatsapp', 'text'));

-- ─── Actualizar trigger: nuevos agentes arrancan con trial de 14 días ─────────

create or replace function tgfn_create_agent_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id from subscription_plans where slug = 'consolidado';

  insert into public.agents (
    id, full_name, email,
    plan_id, subscription_status, trial_ends_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    v_plan_id,
    'trial',
    now() + interval '14 days'
  );
  return new;
end;
$$;
