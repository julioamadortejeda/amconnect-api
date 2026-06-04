-- ─── Catálogos por asesor ─────────────────────────────────────────────────────
-- carriers, branches y products pasan a ser por asesor.
-- Cada asesor gestiona su propio catálogo de aseguradoras, ramos y productos.

-- Eliminar seed global de branches (ya no aplica sin agent_id)
delete from branches;

-- ─── carriers ────────────────────────────────────────────────────────────────

alter table carriers
  add column agent_id uuid not null references agents(id),
  add column deleted_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table carriers enable row level security;

create policy "carriers: own records"
  on carriers for all
  using (agent_id = auth.uid());

-- ─── branches ────────────────────────────────────────────────────────────────

-- El código ya no es único globalmente; puede repetirse entre asesores
alter table branches drop constraint if exists branches_code_key;

alter table branches
  add column agent_id uuid not null references agents(id),
  add column deleted_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table branches enable row level security;

create policy "branches: own records"
  on branches for all
  using (agent_id = auth.uid());

-- ─── products ────────────────────────────────────────────────────────────────

alter table products
  add column agent_id uuid not null references agents(id),
  add column deleted_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table products enable row level security;

create policy "products: own records"
  on products for all
  using (agent_id = auth.uid());
