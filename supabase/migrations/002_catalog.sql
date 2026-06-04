-- ─── Catálogos (datos maestros, sin agent_id) ────────────────────────────────

create table carriers (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  short_name  text,
  logo_url    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table branches (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,       -- Vida, Gastos Médicos, Auto, Daños, etc.
  code        text unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default uuid_generate_v4(),
  carrier_id  uuid not null references carriers(id),
  branch_id   uuid not null references branches(id),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table currencies (
  id          uuid primary key default uuid_generate_v4(),
  code        text not null unique,   -- MXN, USD
  name        text not null,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table payment_frequencies (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,          -- Mensual, Trimestral, Semestral, Anual
  months      int not null,           -- 1, 3, 6, 12
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table payment_methods (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,          -- Domiciliación, Transferencia, Cheque, Efectivo
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table policy_statuses (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,          -- Vigente, Cancelada, Vencida, En Trámite
  code        text unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table participant_roles (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,          -- Titular, Asegurado, Contratante
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table reminder_types (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,          -- Pago, Renovación, Cancelación, Seguimiento, Llamada
  code        text unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─── Seed de catálogos base ────────────────────────────────────────────────────

insert into currencies (code, name, is_default) values
  ('MXN', 'Peso Mexicano', true),
  ('USD', 'Dólar Americano', false);

insert into branches (name, code) values
  ('Vida', 'VIDA'),
  ('Gastos Médicos Mayores', 'GMM'),
  ('Auto', 'AUTO'),
  ('Daños', 'DANOS'),
  ('Retiro', 'RETIRO'),
  ('Educación', 'EDUCACION');

insert into payment_frequencies (name, months) values
  ('Mensual', 1),
  ('Trimestral', 3),
  ('Semestral', 6),
  ('Anual', 12);

insert into payment_methods (name) values
  ('Domiciliación'),
  ('Transferencia Bancaria'),
  ('Cheque'),
  ('Efectivo'),
  ('Tarjeta de Crédito');

insert into policy_statuses (name, code) values
  ('Vigente', 'VIGENTE'),
  ('Cancelada', 'CANCELADA'),
  ('Vencida', 'VENCIDA'),
  ('En Trámite', 'EN_TRAMITE'),
  ('Suspendida', 'SUSPENDIDA');

insert into participant_roles (name) values
  ('Titular'),
  ('Asegurado'),
  ('Contratante'),
  ('Dependiente');

insert into reminder_types (name, code) values
  ('Pago de Prima', 'PAGO'),
  ('Renovación', 'RENOVACION'),
  ('Cancelación', 'CANCELACION'),
  ('Seguimiento', 'SEGUIMIENTO'),
  ('Llamada', 'LLAMADA'),
  ('Cita', 'CITA');
