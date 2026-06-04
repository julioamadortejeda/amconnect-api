-- ─── Agentes (asesores) ───────────────────────────────────────────────────────

create table agents (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  phone       text,
  plan        text not null default 'free',   -- 'free' | 'pro'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── Contactos (clientes del asesor) ─────────────────────────────────────────

create table contacts (
  id          uuid primary key default uuid_generate_v4(),
  agent_id    uuid not null references agents(id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  birthdate   date,
  rfc         text,
  curp        text,
  address     text,
  occupation  text,
  notes       text,    -- notas libres del asesor sobre este contacto
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index idx_contacts_agent_id on contacts(agent_id);
create index idx_contacts_full_name_trgm on contacts using gin(full_name gin_trgm_ops);

-- ─── Pólizas ─────────────────────────────────────────────────────────────────

create table policies (
  id                     uuid primary key default uuid_generate_v4(),
  agent_id               uuid not null references agents(id) on delete cascade,
  contact_id             uuid not null references contacts(id),
  carrier_id             uuid not null references carriers(id),
  product_id             uuid references products(id),
  branch_id              uuid not null references branches(id),
  status_id              uuid not null references policy_statuses(id),
  currency_id            uuid not null references currencies(id),
  payment_frequency_id   uuid references payment_frequencies(id),
  payment_method_id      uuid references payment_methods(id),
  policy_number          text,
  sum_insured            numeric(15, 2),
  premium                numeric(15, 2),
  start_date             date,
  end_date               date,
  renewal_date           date,
  next_payment_date      date,
  notes                  text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index idx_policies_agent_id on policies(agent_id);
create index idx_policies_contact_id on policies(contact_id);
create index idx_policies_policy_number on policies(policy_number);

-- ─── Participantes de la póliza ───────────────────────────────────────────────

create table policy_participants (
  id           uuid primary key default uuid_generate_v4(),
  policy_id    uuid not null references policies(id) on delete cascade,
  contact_id   uuid references contacts(id),
  role_id      uuid not null references participant_roles(id),
  full_name    text,       -- si el participante no es un contacto registrado
  birthdate    date,
  relationship text,
  created_at   timestamptz not null default now()
);

-- ─── Beneficiarios ───────────────────────────────────────────────────────────

create table beneficiaries (
  id           uuid primary key default uuid_generate_v4(),
  policy_id    uuid not null references policies(id) on delete cascade,
  full_name    text not null,
  relationship text,
  percentage   numeric(5, 2),
  created_at   timestamptz not null default now()
);

-- ─── Metadatos de documentos (PDFs de pólizas) ───────────────────────────────

create table document_metadata (
  id               uuid primary key default uuid_generate_v4(),
  agent_id         uuid not null references agents(id),
  policy_id        uuid references policies(id),
  file_name        text not null,
  storage_path     text not null,
  mime_type        text not null default 'application/pdf',
  raw_extraction   jsonb,     -- JSON crudo devuelto por Vertex AI / Gemini
  extracted_at     timestamptz,
  created_at       timestamptz not null default now()
);
