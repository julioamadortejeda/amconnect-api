-- ─── Integridad entre asesores: una fila solo puede apuntar a lo de su asesor ─
--
-- EL PROBLEMA
-- Una FK de Postgres solo revisa que el padre EXISTA, no de quién es, y se
-- valida sin RLS. Así que el asesor A podía apuntar su póliza al contacto de B,
-- su recordatorio a la póliza de B o escribir un mensaje en la sesión de chat
-- de B, con solo conocer el id. El RLS le escondía la fila de B al leer, pero la
-- referencia quedaba guardada. Caso real (2026-11-20): un script de semillas
-- apuntó 15 pólizas del asesor de pruebas a `products` de OTRO asesor (y a
-- través de ellos a sus `carriers`/`branches`); la BD lo aceptó y la app mostró
-- "—" como nombre de producto, porque el RLS de products le escondía el padre.
--
-- EL MECANISMO
-- 1. Donde la tabla hija tiene `agent_id` (21 relaciones): FK COMPUESTA
--    `(agent_id, x_id) references padre (agent_id, id)`. Es declarativa, la
--    revisa el motor en cada INSERT/UPDATE sin importar quién escriba (también
--    service role y scripts), no se puede "olvidar" en un trigger, y con
--    MATCH SIMPLE (el default) una referencia NULL no se revisa: los opcionales
--    (`reminders.policy_id`, `agent_notes.contact_id`, ...) siguen aceptando null.
--    Requiere un UNIQUE (agent_id, id) en cada padre — es redundante con la PK
--    pero es lo que la FK necesita para apuntar.
--    Las FKs simples que ya existían se quedan como están: siguen dando el
--    ON DELETE de siempre. Las compuestas repiten la misma acción (cascade /
--    set null SOLO de la columna referencia, nunca de agent_id) para que el
--    orden en que Postgres dispare las dos no importe.
-- 2. Donde la hija NO tiene `agent_id` y apunta a dos padres
--    (`policy_participants`: póliza + contacto): trigger BEFORE INSERT/UPDATE.
--    No hay columna con la cual armar una FK compuesta; el dueño lo pone la
--    póliza y el contacto tiene que ser del mismo asesor.
--    `beneficiaries` y `reminder_push_deliveries` tienen un solo padre: no hay
--    nada que cruzar (el RLS del padre ya decide).
-- Las dos rutas fallan con 23503 (foreign_key_violation): para A, el registro
-- de B "no existe", y `handleSupabaseError` ya lo traduce a 422
-- VALIDATION_FAILED "el registro relacionado no existe".
--
-- Fuera a propósito: `client_commitments.resolved_by_session_id` no tiene FK
-- por diseño (20260904020000: trazabilidad que sobrevive a purgar sesiones).
--
-- DATOS VIEJOS: NOT VALID + validar solo lo que está limpio
-- En producción puede haber filas cruzadas de antes. Esta migración NO borra
-- ni reescribe nada. Cada FK nueva se crea NOT VALID (desde ese momento protege
-- toda escritura nueva) y luego se valida SOLO si su relación no tiene filas
-- cruzadas. Si tiene, la FK queda NOT VALID y se emite un WARNING con el conteo
-- y el `validate constraint` a correr después de corregir los datos a mano.
-- Se eligió esto en vez de abortar la migración porque abortar deja TODO sin
-- proteger hasta que alguien limpie los datos, y bloquea el deploy por filas de
-- prueba. El orden recomendado sigue siendo: correr
-- `supabase/snippets/check_cross_agent_refs.sql` en prod → corregir → migrar.
-- Una fila vieja cruzada sigue editable: Postgres solo revisa la FK cuando
-- cambian sus columnas.
--
-- Además, dos policies que no revisaban `agent_id`:
--   error_logs        INSERT `with check (true)` → A podía registrar errores como B.
--   reminder_comments INSERT validaba el recordatorio, no la firma → A firmaba como B.
--
-- Re-ejecutable: todo va con if-not-exists / drop-if-exists.

-- ─── 1. UNIQUE (agent_id, id) en los padres ─────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'policies', 'products', 'carriers', 'branches',
                           'reminders', 'ai_sessions', 'agent_notes', 'document_metadata'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = format('public.%I', t)::regclass
                      and conname = t || '_agent_id_id_key') then
      execute format('alter table public.%I add constraint %I unique (agent_id, id)',
                     t, t || '_agent_id_id_key');
    end if;
  end loop;
end $$;

-- ─── 2. FKs compuestas (hija con agent_id) ──────────────────────────────────

do $$
declare
  r record;
  v_name text;
  v_bad bigint;
  v_pending text := '';
begin
  -- hija, columna, padre, on delete (el mismo que la FK simple existente)
  for r in select * from (values
    ('products',               'branch_id',            'branches',          'no action'),
    ('products',               'carrier_id',           'carriers',          'no action'),
    ('contacts',               'referred_by_id',       'contacts',          'no action'),
    ('policies',               'contact_id',           'contacts',          'no action'),
    ('policies',               'product_id',           'products',          'no action'),
    ('reminders',              'contact_id',           'contacts',          'no action'),
    ('reminders',              'policy_id',            'policies',          'no action'),
    ('reminder_settings',      'branch_id',            'branches',          'cascade'),
    ('reminder_comments',      'reminder_id',          'reminders',         'cascade'),
    ('reminder_notifications', 'reminder_id',          'reminders',         'cascade'),
    ('client_commitments',     'contact_id',           'contacts',          'cascade'),
    ('agent_notes',            'contact_id',           'contacts',          'set null'),
    ('agent_notes',            'policy_id',            'policies',          'set null'),
    ('agent_notes',            'reminder_id',          'reminders',         'set null'),
    ('agent_notes',            'document_metadata_id', 'document_metadata', 'set null'),
    ('agent_note_chunks',      'note_id',              'agent_notes',       'cascade'),
    ('ai_chat_messages',       'session_id',           'ai_sessions',       'cascade'),
    ('ai_pending_tasks',       'session_id',           'ai_sessions',       'cascade'),
    ('tokens_usage',           'session_id',           'ai_sessions',       'cascade'),
    ('tokens_usage',           'note_id',              'agent_notes',       'cascade'),
    ('tokens_usage',           'document_metadata_id', 'document_metadata', 'cascade')
    ) v(child, col, parent, on_delete) loop
    v_name := format('%s_%s_same_agent_fkey', r.child, r.col);

    if not exists (select 1 from pg_constraint
                    where conrelid = format('public.%I', r.child)::regclass and conname = v_name) then
      execute format(
        'alter table public.%I add constraint %I foreign key (agent_id, %I) '
        'references public.%I (agent_id, id) on delete %s not valid',
        r.child, v_name, r.col, r.parent,
        case r.on_delete when 'set null' then format('set null (%I)', r.col) else r.on_delete end);
    end if;

    if exists (select 1 from pg_constraint
                where conrelid = format('public.%I', r.child)::regclass
                  and conname = v_name and not convalidated) then
      execute format(
        'select count(*) from public.%I c join public.%I p on p.id = c.%I where p.agent_id <> c.agent_id',
        r.child, r.parent, r.col) into v_bad;

      if v_bad = 0 then
        execute format('alter table public.%I validate constraint %I', r.child, v_name);
      else
        v_pending := v_pending || format(E'\n  %s.%s -> %s: %s filas cruzadas  →  alter table public.%I validate constraint %I;',
                                         r.child, r.col, r.parent, v_bad, r.child, v_name);
      end if;
    end if;
  end loop;

  if v_pending <> '' then
    raise warning 'tenant_integrity: FKs creadas NOT VALID por datos viejos cruzados entre asesores. '
                  'Protegen escrituras nuevas; corregir las filas (supabase/snippets/check_cross_agent_refs.sql) '
                  'y luego validar:%', v_pending;
  end if;
end $$;

-- ─── 3. policy_participants: el contacto, del mismo asesor que la póliza ────
-- Security invoker a propósito: con el JWT del asesor, el contacto de otro
-- asesor ni siquiera se ve (agent_id null) y cae en el mismo error. Si la
-- póliza no se ve, se deja pasar: el RLS de policy_participants lo rechaza con
-- 42501, que es el error correcto para "la póliza no es tuya".

create or replace function public.tgfn_policy_participants_same_agent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_policy_agent uuid;
  v_contact_agent uuid;
begin
  if new.contact_id is null then
    return new;
  end if;

  select agent_id into v_policy_agent from policies where id = new.policy_id;
  if v_policy_agent is null then
    return new;
  end if;

  select agent_id into v_contact_agent from contacts where id = new.contact_id;
  if v_contact_agent is distinct from v_policy_agent then
    raise exception 'policy_participants: contact % does not belong to the policy''s advisor', new.contact_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_policy_participants_same_agent on public.policy_participants;
create trigger tg_policy_participants_same_agent
  before insert or update of policy_id, contact_id on public.policy_participants
  for each row execute function public.tgfn_policy_participants_same_agent();

do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
    from policy_participants pp
    join policies p on p.id = pp.policy_id
    join contacts c on c.id = pp.contact_id
   where c.agent_id <> p.agent_id;
  if v_bad > 0 then
    raise warning 'tenant_integrity: % filas de policy_participants con contacto de otro asesor (el trigger solo protege escrituras nuevas)', v_bad;
  end if;
end $$;

-- ─── 4. Policies que no revisaban agent_id ──────────────────────────────────
-- error_logs: el globalErrorHandler inserta con el cliente del request, que
-- solo existe después de auth (agent_id = user.id). Los crons insertan con
-- service role y no pasan por aquí. No hay caso legítimo de agent_id ajeno
-- o null con el JWT del asesor.

drop policy if exists "error_logs: authenticated insert" on public.error_logs;
create policy "error_logs: authenticated insert"
  on public.error_logs for insert
  to authenticated
  with check (agent_id = auth.uid());

drop policy if exists "reminder_comments: insert own" on public.reminder_comments;
create policy "reminder_comments: insert own"
  on public.reminder_comments for insert
  with check (
    agent_id = auth.uid()
    and exists (
      select 1 from public.reminders r
       where r.id = reminder_comments.reminder_id
         and r.agent_id = auth.uid()
    )
  );
