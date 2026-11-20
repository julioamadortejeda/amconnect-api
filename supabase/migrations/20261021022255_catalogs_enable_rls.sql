-- Los catálogos globales se crearon sin RLS (002_catalog.sql y siguientes) y
-- el advisor de Supabase los marca como rls_disabled_in_public: con la anon key
-- cualquiera podía leer, editar y borrar sus filas por el Data API.
--
-- Solo lectura para authenticated. Las escrituras quedan para migraciones
-- (postgres) y el cron (service_role), que no pasan por RLS.

alter table currencies          enable row level security;
alter table policy_statuses     enable row level security;
alter table participant_roles   enable row level security;
alter table payment_frequencies enable row level security;
alter table payment_methods     enable row level security;
alter table reminder_types      enable row level security;
alter table reminder_statuses   enable row level security;
alter table ai_models           enable row level security;

create policy "currencies: read by authenticated"
  on currencies for select to authenticated using (true);

create policy "policy_statuses: read by authenticated"
  on policy_statuses for select to authenticated using (true);

create policy "participant_roles: read by authenticated"
  on participant_roles for select to authenticated using (true);

create policy "payment_frequencies: read by authenticated"
  on payment_frequencies for select to authenticated using (true);

create policy "payment_methods: read by authenticated"
  on payment_methods for select to authenticated using (true);

create policy "reminder_types: read by authenticated"
  on reminder_types for select to authenticated using (true);

create policy "reminder_statuses: read by authenticated"
  on reminder_statuses for select to authenticated using (true);

create policy "ai_models: read by authenticated"
  on ai_models for select to authenticated using (true);
