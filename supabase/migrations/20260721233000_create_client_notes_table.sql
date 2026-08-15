-- client_notes: reemplaza el texto concatenado en contacts.notes ("[dd/mm/aaaa]: ...")
-- por una fila por nota, evitando que un editor manual rompa la nomenclatura de fecha.
-- Mismo patrón que reminder_comments (ver 20260611183000_create_reminder_comments_table.sql).

create table client_notes (
  id         uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  agent_id   uuid not null references agents(id) on delete cascade,
  content    text not null,
  is_active  boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index client_notes_contact_id_idx on client_notes(contact_id);

alter table client_notes enable row level security;

create policy "client_notes: own records"
  on client_notes for all
  using (agent_id = auth.uid());

-- ─── Backfill: parte contacts.notes en filas individuales ─────────────────────
-- Cada línea "[dd/mm/aaaa]: texto" se convierte en una nota con su fecha real.
-- Cualquier línea que no matchee ese formato (texto libre editado a mano, o la
-- nota inicial sin fecha que crea create_contact) se agrupa en una sola nota
-- "legacy" fechada con el created_at del contacto.
do $$
declare
  c record;
  line text;
  m text[];
  leftover text[];
begin
  for c in select id, agent_id, notes, created_at from contacts where notes is not null and btrim(notes) <> '' loop
    leftover := array[]::text[];
    foreach line in array regexp_split_to_array(c.notes, E'\n') loop
      m := regexp_match(line, '^\[(\d{2})/(\d{2})/(\d{4})\]:\s?(.*)$');
      if m is not null then
        insert into client_notes (contact_id, agent_id, content, created_at)
        values (
          c.id, c.agent_id, btrim(m[4]),
          make_timestamptz(m[3]::int, m[2]::int, m[1]::int, 12, 0, 0, 'UTC')
        );
      elsif btrim(line) <> '' then
        leftover := array_append(leftover, line);
      end if;
    end loop;
    if array_length(leftover, 1) > 0 then
      insert into client_notes (contact_id, agent_id, content, created_at)
      values (c.id, c.agent_id, array_to_string(leftover, E'\n'), c.created_at);
    end if;
  end loop;
end $$;

alter table contacts drop column notes;

alter table client_notes replica identity full;
alter publication supabase_realtime add table client_notes;
