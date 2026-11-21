-- Búsquedas de `recall` guardadas (D-012, "mismo vector para la misma búsqueda").
--
-- La primera llamada de `recall` calcula el embedding de la consulta y lo guarda
-- aquí; la skill devuelve el `searchId` y las páginas siguientes (o "más de este
-- documento") lo reutilizan en vez de volver a llamar al proveedor. Así la
-- página 2 se ordena con EXACTAMENTE el mismo vector que la 1, aunque el
-- proveedor deje de ser determinista. El vector nunca sale hacia el modelo.
--
-- TTL de 30 minutos, aplicado al LEER (created_at > now() - 30 min). La limpieza
-- es un delete de las filas vencidas del propio asesor al insertar una nueva
-- (RecallSearchRepository): sin cron nuevo, la tabla no crece porque cada
-- asesor solo acumula lo de sus últimos 30 minutos, y el RLS ya acota el delete.

create table recall_searches (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references agents(id) on delete cascade,
  query      text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now()
);

create index idx_recall_searches_agent_created on recall_searches (agent_id, created_at desc);

alter table recall_searches enable row level security;

create policy "recall_searches: select own" on recall_searches
  for select to authenticated using (agent_id = auth.uid());
create policy "recall_searches: insert own" on recall_searches
  for insert to authenticated with check (agent_id = auth.uid());
create policy "recall_searches: delete own" on recall_searches
  for delete to authenticated using (agent_id = auth.uid());

revoke all on recall_searches from public, anon, authenticated;
grant select, insert, delete on recall_searches to authenticated;
grant select, insert, update, delete on recall_searches to service_role;
