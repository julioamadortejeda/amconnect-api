-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Todas las tablas con agent_id están filtradas por el JWT del usuario autenticado

alter table agents              enable row level security;
alter table contacts            enable row level security;
alter table policies            enable row level security;
alter table policy_participants enable row level security;
alter table beneficiaries       enable row level security;
alter table document_metadata   enable row level security;
alter table reminders           enable row level security;
alter table reminder_settings   enable row level security;
alter table ai_sessions         enable row level security;
alter table ai_chat_messages    enable row level security;
alter table agent_notes_vectors enable row level security;
alter table ai_pending_tasks    enable row level security;

-- ─── Agentes ──────────────────────────────────────────────────────────────────

create policy "agents: own profile"
  on agents for all
  using (id = auth.uid());

-- ─── Contactos ────────────────────────────────────────────────────────────────

create policy "contacts: own records"
  on contacts for all
  using (agent_id = auth.uid());

-- ─── Pólizas ─────────────────────────────────────────────────────────────────

create policy "policies: own records"
  on policies for all
  using (agent_id = auth.uid());

-- ─── Participantes de póliza ─────────────────────────────────────────────────

create policy "policy_participants: via policy owner"
  on policy_participants for all
  using (
    exists (
      select 1 from policies p
      where p.id = policy_participants.policy_id
        and p.agent_id = auth.uid()
    )
  );

-- ─── Beneficiarios ────────────────────────────────────────────────────────────

create policy "beneficiaries: via policy owner"
  on beneficiaries for all
  using (
    exists (
      select 1 from policies p
      where p.id = beneficiaries.policy_id
        and p.agent_id = auth.uid()
    )
  );

-- ─── Documentos ───────────────────────────────────────────────────────────────

create policy "document_metadata: own records"
  on document_metadata for all
  using (agent_id = auth.uid());

-- ─── Recordatorios ────────────────────────────────────────────────────────────

create policy "reminders: own records"
  on reminders for all
  using (agent_id = auth.uid());

create policy "reminder_settings: own records"
  on reminder_settings for all
  using (agent_id = auth.uid());

-- ─── IA ───────────────────────────────────────────────────────────────────────

create policy "ai_sessions: own records"
  on ai_sessions for all
  using (agent_id = auth.uid());

create policy "ai_chat_messages: own records"
  on ai_chat_messages for all
  using (agent_id = auth.uid());

create policy "agent_notes_vectors: own records"
  on agent_notes_vectors for all
  using (agent_id = auth.uid());

create policy "ai_pending_tasks: own records"
  on ai_pending_tasks for all
  using (agent_id = auth.uid());

-- ─── Catálogos: lectura pública (sin RLS) ────────────────────────────────────
-- carriers, branches, products, currencies, payment_frequencies,
-- payment_methods, policy_statuses, participant_roles, reminder_types
-- son tablas de referencia que todos pueden leer.
