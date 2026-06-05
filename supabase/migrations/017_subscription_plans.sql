-- ─── Planes de suscripción ────────────────────────────────────────────────────

create table subscription_plans (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,
  price_mxn   numeric(10,2) not null,
  price_usd   numeric(10,2) not null,
  limits      jsonb not null,
  -- limits structure:
  -- {
  --   "chat_messages_monthly": 300,
  --   "ingestions_monthly":    15,
  --   "storage_mb":            512
  -- }
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into subscription_plans (slug, name, price_mxn, price_usd, limits) values
  ('nuevo',       'Nuevo',       349.00,  19.00, '{"chat_messages_monthly":300,  "ingestions_monthly":15,  "storage_mb":512}'),
  ('consolidado', 'Consolidado', 749.00,  42.00, '{"chat_messages_monthly":1000, "ingestions_monthly":40,  "storage_mb":1024}'),
  ('top',         'Top',        1499.00,  83.00, '{"chat_messages_monthly":3000, "ingestions_monthly":120, "storage_mb":5120}');

-- Legible por cualquier usuario autenticado (el frontend muestra los planes disponibles)
alter table subscription_plans enable row level security;

create policy "subscription_plans: read by authenticated"
  on subscription_plans for select
  using (auth.role() = 'authenticated');
