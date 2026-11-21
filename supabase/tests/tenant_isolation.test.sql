-- Aislamiento entre asesores (RLS) en TODAS las tablas de `public` y en Storage.
-- Correr con: supabase test db
--
-- Qué prueba:
--   1. Meta-pruebas sobre el esquema: toda tabla de `public` tiene RLS, tiene
--      policies (salvo las de solo-servidor, que se listan a propósito) y está
--      CLASIFICADA abajo. Una tabla nueva sin clasificar rompe esta suite: hay
--      que decidir de quién son sus filas antes de que llegue a producción.
--   2. Que el asesor A, con su JWT y el rol `authenticated` (lo mismo que tiene
--      cualquiera que tome su token y le hable directo al Data API), NO puede
--      leer, editar, borrar, dar de baja (soft delete), ni insertar a nombre del
--      asesor B, en cada tabla con `agent_id`. Las pruebas de tabla se generan
--      desde la clasificación, no se escriben a mano: si una tabla nueva entra
--      como 'agent', hereda todas las pruebas sin escribir nada más.
--   3. Tablas hijas (cuyo dueño se decide por la póliza o el recordatorio
--      padre), catálogos de solo lectura, el perfil, `anon` y Storage.
--
-- Convención: "denegado" = la BD responde 42501 o la sentencia afecta 0 filas.
-- Las dos cosas significan lo mismo para el atacante: no pasó nada.

begin;
select * from no_plan();

-- ─── Utilidades (como postgres) ──────────────────────────────────────────────

create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create or replace function pg_temp.login_anon() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
$$;

-- Ejecuta una sentencia y devuelve 'ok:<filas afectadas>' o el SQLSTATE del
-- error. Corre con los privilegios de quien la llama (security invoker), así
-- que respeta el RLS del rol activo.
create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return sqlstate;
end;
$$;

-- Cuenta filas visibles; devuelve el número o el SQLSTATE si ni siquiera puede leer.
create or replace function pg_temp.visible(p_sql text) returns text language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql into n;
  return n::text;
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.login_as(uuid) to authenticated, anon;
grant execute on function pg_temp.login_anon() to authenticated, anon;
grant execute on function pg_temp.attempt(text) to authenticated, anon;
grant execute on function pg_temp.visible(text) to authenticated, anon;

-- ─── Clasificación de TODAS las tablas de public ─────────────────────────────
--   agent        filas del asesor, CRUD completo sobre lo propio (agent_id = auth.uid())
--   own_readonly filas del asesor que SOLO escribe el servidor (cuota, cobros, bitácora de push)
--   own_append   el asesor lee e inserta lo propio, no edita ni borra (tokens_usage)
--   insert_only  el asesor solo inserta, no lee (error_logs)
--   child        el dueño lo decide la fila padre (póliza / recordatorio)
--   profile      agents: el perfil propio
--   catalog      global, solo lectura para authenticated
--   server_only  sin acceso desde el Data API (RLS sin policies a propósito)

-- Solo entran las tablas que existen en ESTA base: así la misma suite sirve en
-- una rama que todavía no trae una tabla (p. ej. privacy_consents, de la rama
-- de consentimiento) y en la base compartida que ya la tiene.
create temp table t_class (tbl text primary key, kind text not null) on commit drop;
insert into t_class
select * from (values
  ('agent_device_tokens',   'agent'),
  ('agent_note_chunks',     'agent'),
  ('agent_notes',           'agent'),
  ('ai_chat_messages',      'agent'),
  ('ai_pending_tasks',      'agent'),
  ('ai_sessions',           'agent'),
  ('branches',              'agent'),
  ('carriers',              'agent'),
  ('client_commitments',    'agent'),
  ('contacts',              'agent'),
  ('document_metadata',     'agent'),
  ('policies',              'agent'),
  ('products',              'agent'),
  ('reminder_settings',     'agent'),
  ('reminders',             'agent'),
  ('agent_monthly_usage',   'own_readonly'),
  ('reminder_notifications','own_readonly'),
  ('usage_charges',         'own_readonly'),
  ('tokens_usage',          'own_append'),
  ('error_logs',            'insert_only'),
  ('beneficiaries',         'child'),
  ('policy_participants',   'child'),
  ('reminder_comments',     'child'),
  ('agents',                'profile'),
  ('ai_models',             'catalog'),
  ('currencies',            'catalog'),
  ('participant_roles',     'catalog'),
  ('payment_frequencies',   'catalog'),
  ('payment_methods',       'catalog'),
  ('policy_statuses',       'catalog'),
  ('reminder_statuses',     'catalog'),
  ('reminder_types',        'catalog'),
  ('search_stopwords',      'catalog'),
  ('search_synonyms',       'catalog'),
  ('subscription_plans',    'catalog'),
  ('system_prompts',        'catalog'),
  ('privacy_consents',      'own_readonly'),
  ('promo_codes',           'server_only'),
  ('reminder_push_deliveries', 'server_only')
) v(tbl, kind)
where to_regclass('public.' || v.tbl) is not null;
grant select on t_class to authenticated, anon;

-- Tablas reales de public (base y particionadas).
create temp view v_public_tables as
  select c.relname::text as tbl, c.relrowsecurity as rls,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) as n_policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p');

-- ═══ 1. Meta-pruebas sobre el esquema ════════════════════════════════════════

select is_empty(
  $$ select tbl from v_public_tables where not rls $$,
  'META: ninguna tabla de public tiene RLS apagado'
);

select is_empty(
  $$ select v.tbl from v_public_tables v
      left join t_class k using (tbl)
     where v.n_policies = 0 and coalesce(k.kind, '') <> 'server_only' $$,
  'META: toda tabla de public tiene al menos una policy (salvo las server_only declaradas)'
);

select is_empty(
  $$ select v.tbl from v_public_tables v
      left join t_class k using (tbl) where k.tbl is null $$,
  'META: toda tabla de public está clasificada en esta suite (agregar la nueva a t_class)'
);

select is_empty(
  $$ select k.tbl from t_class k join v_public_tables v using (tbl)
      where k.kind = 'server_only' and v.n_policies > 0 $$,
  'META: las tablas server_only de verdad no tienen policies'
);

-- Toda tabla con agent_id (salvo error_logs, que solo inserta) debe tener al
-- menos una policy que compare contra auth.uid(). Una policy `using (true)`
-- pasaría la meta-prueba de "tiene policies" y abriría la tabla entera.
select is_empty(
  $$ select k.tbl from t_class k
      where k.kind in ('agent', 'own_readonly', 'own_append')
        and not exists (
          select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = k.tbl
             and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%auth.uid()%') $$,
  'META: toda tabla de asesor filtra por auth.uid() en sus policies'
);

-- Las vistas se saltan el RLS de sus tablas salvo que se creen con
-- security_invoker. Hoy no hay ninguna; si alguien agrega una, que sea así.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'META: no hay vistas en public que se salten el RLS (security_invoker obligatorio)'
);

-- Toda función security definer de public ya fue revisada (verifica quién la
-- llama). Una nueva rompe esta prueba hasta que se revise y se agregue aquí.
-- accept_privacy_policy / record_privacy_consent: rama de consentimiento;
-- ambas toman el asesor de auth.uid(), no de un parámetro.
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname not in ('apply_promo_code', 'increment_monthly_usage',
                              'refund_usage_charge', 'claim_device_token',
                              'assert_usage_caller', 'accept_privacy_policy',
                              'record_privacy_consent',
                              'tgfn_create_agent_profile') $$,
  'META: no hay funciones security definer sin revisar en public'
);

select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'META: anon no puede ejecutar ninguna función security definer'
);

-- ═══ 2. Datos de prueba (como postgres) ══════════════════════════════════════

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1a1a1a1-0000-4000-8000-00000000000a', 'iso.a@test.local', '{"full_name":"Iso A"}'),
  ('b2b2b2b2-0000-4000-8000-00000000000b', 'iso.b@test.local', '{"full_name":"Iso B"}');

-- ids sembrados por asesor y tabla
create temp table t_ids (agent uuid, tbl text, id uuid, primary key (agent, tbl)) on commit drop;
grant select on t_ids to authenticated, anon;

create or replace function pg_temp.seed(p_agent uuid, p_tag text) returns void language plpgsql as $$
declare
  v_contact uuid; v_carrier uuid; v_branch uuid; v_product uuid; v_policy uuid;
  v_reminder uuid; v_doc uuid; v_note uuid; v_session uuid; v_id uuid;
  v_type uuid := (select id from reminder_types where code = 'CALL');
  v_status uuid := (select id from reminder_statuses where code = 'CREATED');
begin
  insert into contacts (agent_id, full_name) values (p_agent, 'Cliente ' || p_tag) returning id into v_contact;
  insert into t_ids values (p_agent, 'contacts', v_contact);

  insert into carriers (agent_id, name) values (p_agent, 'Aseguradora ' || p_tag) returning id into v_carrier;
  insert into t_ids values (p_agent, 'carriers', v_carrier);

  insert into branches (agent_id, name) values (p_agent, 'Ramo ' || p_tag) returning id into v_branch;
  insert into t_ids values (p_agent, 'branches', v_branch);

  insert into products (agent_id, carrier_id, branch_id, name)
  values (p_agent, v_carrier, v_branch, 'Producto ' || p_tag) returning id into v_product;
  insert into t_ids values (p_agent, 'products', v_product);

  insert into policies (agent_id, contact_id, product_id, status_id, currency_id, policy_number)
  values (p_agent, v_contact, v_product,
          (select id from policy_statuses where code = 'ACTIVE'),
          (select id from currencies where code = 'MXN'),
          'ISO-' || p_tag)
  returning id into v_policy;
  insert into t_ids values (p_agent, 'policies', v_policy);

  insert into policy_participants (policy_id, contact_id, role_id)
  values (v_policy, v_contact, (select id from participant_roles where code = 'HOLDER'))
  returning id into v_id;
  insert into t_ids values (p_agent, 'policy_participants', v_id);

  insert into beneficiaries (policy_id, full_name, percentage)
  values (v_policy, 'Beneficiario ' || p_tag, 100) returning id into v_id;
  insert into t_ids values (p_agent, 'beneficiaries', v_id);

  insert into reminders (agent_id, contact_id, type_id, status_id, title, due_date)
  values (p_agent, v_contact, v_type, v_status, 'Llamar ' || p_tag, now() + interval '1 day')
  returning id into v_reminder;
  insert into t_ids values (p_agent, 'reminders', v_reminder);

  insert into reminder_comments (reminder_id, agent_id, content)
  values (v_reminder, p_agent, 'Comentario ' || p_tag) returning id into v_id;
  insert into t_ids values (p_agent, 'reminder_comments', v_id);

  insert into reminder_notifications (reminder_id, agent_id, due_date_at_send)
  values (v_reminder, p_agent, now()) returning id into v_id;
  insert into t_ids values (p_agent, 'reminder_notifications', v_id);

  insert into reminder_settings (agent_id, reminder_type_id, days_before)
  values (p_agent, v_type, 3) returning id into v_id;
  insert into t_ids values (p_agent, 'reminder_settings', v_id);

  insert into document_metadata (agent_id, file_name, storage_path, ingestion_type)
  values (p_agent, 'poliza.pdf', p_agent || '/poliza.pdf', 'pdf') returning id into v_doc;
  insert into t_ids values (p_agent, 'document_metadata', v_doc);

  insert into agent_notes (agent_id, contact_id, source_type, content, document_metadata_id)
  values (p_agent, v_contact, 'text', 'Nota privada ' || p_tag, v_doc) returning id into v_note;
  insert into t_ids values (p_agent, 'agent_notes', v_note);

  insert into agent_note_chunks (agent_id, note_id, chunk_index, content)
  values (p_agent, v_note, 0, 'Fragmento ' || p_tag) returning id into v_id;
  insert into t_ids values (p_agent, 'agent_note_chunks', v_id);

  insert into client_commitments (agent_id, contact_id, label, quote)
  values (p_agent, v_contact, 'Compromiso ' || p_tag, 'te llamo el lunes') returning id into v_id;
  insert into t_ids values (p_agent, 'client_commitments', v_id);

  insert into agent_device_tokens (agent_id, token, platform)
  values (p_agent, 'iso-token-' || p_tag, 'ios') returning id into v_id;
  insert into t_ids values (p_agent, 'agent_device_tokens', v_id);

  insert into ai_sessions (agent_id, trigger_message) values (p_agent, 'hola ' || p_tag)
  returning id into v_session;
  insert into t_ids values (p_agent, 'ai_sessions', v_session);

  insert into ai_chat_messages (session_id, agent_id, role, content)
  values (v_session, p_agent, 'user', 'mensaje ' || p_tag) returning id into v_id;
  insert into t_ids values (p_agent, 'ai_chat_messages', v_id);

  insert into ai_pending_tasks (session_id, agent_id, task_type, payload)
  values (v_session, p_agent, 'create_reminder', '{}'::jsonb) returning id into v_id;
  insert into t_ids values (p_agent, 'ai_pending_tasks', v_id);

  insert into tokens_usage (agent_id, session_id, source, model_name, total_tokens)
  values (p_agent, v_session, 'chat', (select model_name from ai_models limit 1), 10) returning id into v_id;
  insert into t_ids values (p_agent, 'tokens_usage', v_id);

  insert into error_logs (agent_id, error_type, status_code, error_message)
  values (p_agent, 'TEST', 500, 'error ' || p_tag) returning id into v_id;
  insert into t_ids values (p_agent, 'error_logs', v_id);

  insert into usage_charges (agent_id, field, year_month)
  values (p_agent, 'chat', date_trunc('month', now())::date) returning id into v_id;
  insert into t_ids values (p_agent, 'usage_charges', v_id);

  insert into agent_monthly_usage (agent_id, year_month, chat_count, ingestion_count)
  values (p_agent, '2001-01-01', 1, 0);

  if to_regclass('public.privacy_consents') is not null then
    execute format($q$ insert into privacy_consents (agent_id, version, accepted_notice, accepted_sensitive)
                       values (%L, 'test', true, true) returning id $q$, p_agent) into v_id;
    insert into t_ids values (p_agent, 'privacy_consents', v_id);
  end if;
end;
$$;

select pg_temp.seed('a1a1a1a1-0000-4000-8000-00000000000a', 'A');
select pg_temp.seed('b2b2b2b2-0000-4000-8000-00000000000b', 'B');

-- Fila "válida" de B por tabla, con id nuevo: lo que el atacante intentaría
-- insertar. Si el insert falla, que sea por RLS y no por un dato inválido.
create temp table t_rows (tbl text primary key, b_row jsonb) on commit drop;
grant select on t_rows to authenticated, anon;

do $$
declare r record; v jsonb;
begin
  for r in select tbl from t_class where kind in ('agent', 'own_readonly', 'own_append') loop
    execute format('select to_jsonb(t) from %I t where agent_id = %L limit 1',
                   r.tbl, 'b2b2b2b2-0000-4000-8000-00000000000b') into v;
    insert into t_rows values (r.tbl, v || jsonb_build_object('id', gen_random_uuid(),
                                                              'year_month', '2002-02-01'));
  end loop;
end $$;

select is_empty(
  $$ select k.tbl from t_class k left join t_rows r using (tbl)
      where k.kind in ('agent', 'own_readonly', 'own_append') and r.b_row is null $$,
  'SETUP: hay una fila de B sembrada en cada tabla de asesor'
);

-- Objetos de Storage de cada asesor (bucket privado `policies`, carpeta = id).
insert into storage.objects (bucket_id, name, owner)
values
  ('policies', 'a1a1a1a1-0000-4000-8000-00000000000a/poliza.pdf', 'a1a1a1a1-0000-4000-8000-00000000000a'),
  ('policies', 'b2b2b2b2-0000-4000-8000-00000000000b/poliza.pdf', 'b2b2b2b2-0000-4000-8000-00000000000b');

-- ═══ 3. Tablas de asesor: A contra los datos de B ════════════════════════════

select pg_temp.login_as('a1a1a1a1-0000-4000-8000-00000000000a');

-- Que las pruebas no sean vacías: A sí ve lo suyo en cada tabla legible.
select cmp_ok(
  pg_temp.visible(format('select count(*) from %I where agent_id = %L',
                         tbl, 'a1a1a1a1-0000-4000-8000-00000000000a'))::int,
  '>=', 1,
  format('CONTROL %s: A ve sus propias filas', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append') order by tbl;

select is(
  pg_temp.visible(format('select count(*) from %I where agent_id = %L',
                         tbl, 'b2b2b2b2-0000-4000-8000-00000000000b')),
  '0',
  format('ATAQUE %s: A no ve filas de B', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append', 'insert_only') order by tbl;

select matches(
  pg_temp.attempt(format('update %I set agent_id = agent_id where agent_id = %L',
                         tbl, 'b2b2b2b2-0000-4000-8000-00000000000b')),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede editar filas de B', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append', 'insert_only') order by tbl;

select matches(
  pg_temp.attempt(format('update %I set agent_id = %L where agent_id = %L', tbl,
                         'a1a1a1a1-0000-4000-8000-00000000000a',
                         'b2b2b2b2-0000-4000-8000-00000000000b')),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede adueñarse de filas de B', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append', 'insert_only') order by tbl;

-- Soft delete (is_active / deleted_at) donde la tabla lo usa.
select matches(
  pg_temp.attempt(format('update %I set %s where agent_id = %L', k.tbl,
    concat_ws(', ',
      case when exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                          and c.table_name = k.tbl and c.column_name = 'is_active')
           then 'is_active = false' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                          and c.table_name = k.tbl and c.column_name = 'deleted_at')
           then 'deleted_at = now()' end),
    'b2b2b2b2-0000-4000-8000-00000000000b')),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede dar de baja (soft delete) filas de B', k.tbl))
from t_class k
where k.kind in ('agent', 'own_readonly', 'own_append')
  and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                and c.table_name = k.tbl and c.column_name in ('is_active', 'deleted_at'))
order by k.tbl;

select matches(
  pg_temp.attempt(format('delete from %I where agent_id = %L',
                         tbl, 'b2b2b2b2-0000-4000-8000-00000000000b')),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede borrar filas de B', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append', 'insert_only') order by tbl;

-- Insertar a nombre de B: tiene que fallar por RLS/permisos (42501), no por
-- otro motivo. Si fallara por un dato inválido, la prueba no probaría nada.
select is(
  pg_temp.attempt(format('insert into %I select * from jsonb_populate_record(null::%I, %L::jsonb)',
                         r.tbl, r.tbl, r.b_row)),
  '42501',
  format('ATAQUE %s: A no puede insertar filas a nombre de B', r.tbl))
from t_rows r order by r.tbl;

-- Regalarle a B una fila propia (cambiar agent_id de lo mío a B).
select matches(
  pg_temp.attempt(format('update %I set agent_id = %L where agent_id = %L', tbl,
                         'b2b2b2b2-0000-4000-8000-00000000000b',
                         'a1a1a1a1-0000-4000-8000-00000000000a')),
  case when kind = 'agent' then '^42501$' else '^(ok:0|42501)$' end,
  format('ATAQUE %s: A no puede pasarle una fila suya a B', tbl))
from t_class where kind in ('agent', 'own_readonly', 'own_append') order by tbl;

-- Solo-servidor: el asesor no puede ni escribir lo propio.
select matches(
  pg_temp.attempt(format('update %I set agent_id = agent_id where agent_id = %L',
                         tbl, 'a1a1a1a1-0000-4000-8000-00000000000a')),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede editar ni sus propias filas (las escribe el servidor)', tbl))
from t_class where kind in ('own_readonly', 'own_append') order by tbl;

-- ═══ 4. Tablas hijas: el dueño lo decide la fila padre ═══════════════════════

select is(
  pg_temp.visible(format('select count(*) from %I where id = %L', tbl,
                         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b'
                            and t_ids.tbl = t_class.tbl))),
  '0',
  format('ATAQUE %s: A no ve la fila hija de B', tbl))
from t_class where kind = 'child' order by tbl;

select cmp_ok(
  pg_temp.visible(format('select count(*) from %I where id = %L', tbl,
                         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a'
                            and t_ids.tbl = t_class.tbl)))::int,
  '=', 1,
  format('CONTROL %s: A ve su propia fila hija', tbl))
from t_class where kind = 'child' order by tbl;

select matches(
  pg_temp.attempt(format('update %I set created_at = created_at where id = %L', tbl,
                         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b'
                            and t_ids.tbl = t_class.tbl))),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede editar la fila hija de B', tbl))
from t_class where kind = 'child' order by tbl;

select matches(
  pg_temp.attempt(format('delete from %I where id = %L', tbl,
                         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b'
                            and t_ids.tbl = t_class.tbl))),
  '^(ok:0|42501)$',
  format('ATAQUE %s: A no puede borrar la fila hija de B', tbl))
from t_class where kind = 'child' order by tbl;

-- Colgar hijos en el padre de B.
select throws_ok(
  format($q$ insert into policy_participants (policy_id, role_id)
             values (%L, (select id from participant_roles where code = 'INSURED')) $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'policies')),
  '42501', null,
  'ATAQUE policy_participants: A no puede agregar un asegurado a la póliza de B'
);

select throws_ok(
  format($q$ insert into beneficiaries (policy_id, full_name, percentage) values (%L, 'Intruso', 50) $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'policies')),
  '42501', null,
  'ATAQUE beneficiaries: A no puede agregar un beneficiario a la póliza de B'
);

select throws_ok(
  format($q$ insert into reminder_comments (reminder_id, agent_id, content) values (%L, %L, 'Intruso') $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'reminders'),
         'a1a1a1a1-0000-4000-8000-00000000000a'),
  '42501', null,
  'ATAQUE reminder_comments: A no puede comentar en el recordatorio de B'
);

-- Mover un hijo propio al padre de B.
select throws_ok(
  format($q$ update beneficiaries set policy_id = %L where id = %L $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'policies'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'beneficiaries')),
  '42501', null,
  'ATAQUE beneficiaries: A no puede mover su beneficiario a la póliza de B'
);

select throws_ok(
  format($q$ update policy_participants set policy_id = %L where id = %L $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'policies'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'policy_participants')),
  '42501', null,
  'ATAQUE policy_participants: A no puede mover su participante a la póliza de B'
);

-- ═══ 5. Perfil, catálogos y funciones con agent_id ═══════════════════════════

select is(
  pg_temp.attempt($q$ update agents set full_name = 'hackeado'
                       where id = 'b2b2b2b2-0000-4000-8000-00000000000b' $q$),
  'ok:0',
  'ATAQUE agents: A no puede editar el perfil de B'
);

select is(
  (select count(*)::int from agents where id = 'b2b2b2b2-0000-4000-8000-00000000000b'),
  0,
  'ATAQUE agents: A no ve el perfil de B'
);

select is(
  pg_temp.attempt($q$ insert into agents (id, full_name, email)
                       values (gen_random_uuid(), 'falso', 'falso@test.local') $q$),
  '42501',
  'ATAQUE agents: A no puede crear perfiles'
);

select throws_ok(
  $$ select apply_promo_code('b2b2b2b2-0000-4000-8000-00000000000b', 'NOEXISTE') $$,
  '42501', null,
  'ATAQUE apply_promo_code: A no puede aplicar un código a nombre de B'
);

-- Catálogos: legibles, nunca escribibles con el JWT del asesor.
select is(
  pg_temp.attempt(format('insert into %I default values', tbl)),
  '42501',
  format('ATAQUE catálogo %s: authenticated no puede insertar', tbl))
from t_class where kind = 'catalog' order by tbl;

select matches(
  pg_temp.attempt(format('update %I set created_at = created_at', tbl)),
  '^(ok:0|42501)$',
  format('ATAQUE catálogo %s: authenticated no puede editar', tbl))
from t_class where kind = 'catalog'
  and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                and c.table_name = t_class.tbl and c.column_name = 'created_at')
order by tbl;

select matches(
  pg_temp.attempt(format('delete from %I', tbl)),
  '^(ok:0|42501)$',
  format('ATAQUE catálogo %s: authenticated no puede borrar', tbl))
from t_class where kind = 'catalog' order by tbl;

select isnt(
  pg_temp.visible(format('select count(*) from %I', tbl)),
  '42501',
  format('CONTROL catálogo %s: authenticated sí puede leerlo', tbl))
from t_class where kind = 'catalog' order by tbl;

select matches(
  pg_temp.visible(format('select count(*) from %I', tbl)),
  '^(0|42501)$',
  format('ATAQUE %s: authenticated no ve nada de una tabla solo-servidor', tbl))
from t_class where kind = 'server_only' order by tbl;

-- ═══ 6. Integridad entre asesores: firmas y referencias cruzadas ════════════
-- Antes eran `todo` (20261121051742_tenant_integrity.sql los cerró).

select is(
  pg_temp.attempt($q$ insert into error_logs (agent_id, error_type, status_code, error_message)
                       values ('b2b2b2b2-0000-4000-8000-00000000000b', 'FAKE', 500, 'x') $q$),
  '42501',
  'ATAQUE error_logs: A no puede registrar errores a nombre de B'
);

select is(
  pg_temp.attempt($q$ insert into error_logs (agent_id, error_type, status_code, error_message)
                       values (null, 'FAKE', 500, 'x') $q$),
  '42501',
  'ATAQUE error_logs: A no puede registrar errores anónimos con su JWT'
);

select is(
  pg_temp.attempt($q$ insert into error_logs (agent_id, error_type, status_code, error_message)
                       values ('a1a1a1a1-0000-4000-8000-00000000000a', 'FAKE', 500, 'x') $q$),
  'ok:1',
  'CONTROL error_logs: A sí registra sus propios errores (globalErrorHandler)'
);

select is(
  pg_temp.attempt(format($q$ insert into reminder_comments (reminder_id, agent_id, content) values (%L, %L, 'firmado como B') $q$,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'reminders'),
         'b2b2b2b2-0000-4000-8000-00000000000b')),
  '42501',
  'ATAQUE reminder_comments: A no puede firmar un comentario como B'
);

select is(
  pg_temp.attempt(format($q$ insert into reminder_comments (reminder_id, agent_id, content) values (%L, %L, 'mío') $q$,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'reminders'),
         'a1a1a1a1-0000-4000-8000-00000000000a')),
  'ok:1',
  'CONTROL reminder_comments: A sí comenta su recordatorio'
);

-- Las FK se validan sin RLS: sin las FK compuestas, A podía colgar SUS filas
-- de un id de B si lo conocía (caso real: pólizas apuntando al producto de
-- otro asesor, la app mostraba "—"). Las pruebas se generan desde el catálogo:
-- toda FK `<hija>_<col>_same_agent_fkey` hereda ataque y control.
create temp view v_same_agent_fk as
  select c.conrelid::regclass::text as child, a.attname::text as col,
         c.confrelid::regclass::text as parent, c.conname::text as conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[2]
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and c.conname like '%\_same\_agent\_fkey';
grant select on v_same_agent_fk to authenticated, anon;

-- META: toda FK de una tabla con agent_id hacia otra tabla con agent_id está
-- cubierta por una FK compuesta. Una relación nueva sin cubrir rompe aquí.
-- Excepción declarada: client_commitments.resolved_by_session_id no tiene FK
-- por diseño (no aparece en pg_constraint).
select is_empty(
  $$ select c.conrelid::regclass || '.' || a.attname
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and array_length(c.conkey, 1) = 1
        and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'agent_id' and not x.attisdropped)
        and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'agent_id' and not x.attisdropped)
        and not exists (select 1 from v_same_agent_fk f
                         where f.child = c.conrelid::regclass::text and f.col = a.attname) $$,
  'META: toda referencia entre tablas de asesor exige el mismo asesor (FK compuesta)'
);

-- Hijas sin agent_id que apuntan a DOS padres de asesor: necesitan trigger.
select is_empty(
  $$ select c.conrelid::regclass::text
       from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'agent_id' and not x.attisdropped)
        and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'agent_id' and not x.attisdropped)
      group by c.conrelid
     having count(*) > 1
     except select 'policy_participants' $$,
  'META: toda tabla hija sin agent_id con dos padres de asesor tiene su trigger declarado'
);

select cmp_ok((select count(*)::int from v_same_agent_fk), '>=', 21,
  'SETUP: las FKs compuestas de mismo asesor existen');

-- Mover lo mío hacia un padre de B (UPDATE). Solo tablas que A puede editar.
select is(
  pg_temp.attempt(format('update %I set %I = %L where agent_id = %L', f.child, f.col,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = f.parent),
         'a1a1a1a1-0000-4000-8000-00000000000a')),
  '23503',
  format('ATAQUE %s.%s: A no puede apuntar su fila a %s de B', f.child, f.col, f.parent))
from v_same_agent_fk f join t_class k on k.tbl = f.child
where k.kind = 'agent' order by f.child, f.col;

-- Crear una fila nueva colgada de un padre de B (INSERT). Tablas donde A inserta.
select is(
  pg_temp.attempt(format('insert into %I select * from jsonb_populate_record(null::%I, %L::jsonb)',
         f.child, f.child,
         -- fila de B, pasada a A con TODAS sus referencias apuntando a lo de A,
         -- salvo la columna bajo prueba: así el 23503 solo puede venir de ella.
         r.b_row
           || jsonb_build_object('agent_id', 'a1a1a1a1-0000-4000-8000-00000000000a')
           || (select coalesce(jsonb_object_agg(o.col, (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = o.parent)), '{}')
                 from v_same_agent_fk o where o.child = f.child and r.b_row ? o.col and r.b_row ->> o.col is not null)
           || jsonb_build_object(f.col, (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = f.parent)))),
  '23503',
  format('ATAQUE %s.%s: A no puede crear una fila colgada de %s de B', f.child, f.col, f.parent))
from v_same_agent_fk f
join t_class k on k.tbl = f.child
join t_rows r on r.tbl = f.child
where k.kind in ('agent', 'own_append') order by f.child, f.col;

-- Controles: apuntar a lo propio sí se puede, y los opcionales aceptan null.
select matches(
  pg_temp.attempt(format('update %I set %I = %L where agent_id = %L', f.child, f.col,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = f.parent),
         'a1a1a1a1-0000-4000-8000-00000000000a')),
  '^ok:[1-9]',
  format('CONTROL %s.%s: A sí apunta su fila a su propio %s', f.child, f.col, f.parent))
from v_same_agent_fk f join t_class k on k.tbl = f.child
where k.kind = 'agent' order by f.child, f.col;

select matches(
  pg_temp.attempt(format('update %I set %I = null where agent_id = %L', f.child, f.col,
         'a1a1a1a1-0000-4000-8000-00000000000a')),
  '^ok:[1-9]',
  format('CONTROL %s.%s: la referencia opcional acepta null', f.child, f.col))
from v_same_agent_fk f join t_class k on k.tbl = f.child
join pg_attribute a on a.attrelid = f.child::regclass and a.attname = f.col
where k.kind = 'agent' and not a.attnotnull order by f.child, f.col;

-- Los casos concretos del hallazgo original, con nombre propio.
select is(
  pg_temp.attempt(format($q$ insert into ai_chat_messages (session_id, agent_id, role, content) values (%L, %L, 'user', 'x') $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'ai_sessions'),
         'a1a1a1a1-0000-4000-8000-00000000000a')),
  '23503',
  'ATAQUE ai_chat_messages: A no puede escribir en la sesión de B'
);

select is(
  pg_temp.attempt(format($q$ insert into policies (agent_id, contact_id, product_id, status_id, currency_id, policy_number)
                              values (%L, %L, %L, (select id from policy_statuses where code = 'ACTIVE'),
                                      (select id from currencies where code = 'MXN'), 'ISO-CRUZADA') $q$,
         'a1a1a1a1-0000-4000-8000-00000000000a',
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'contacts'),
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'products'))),
  '23503',
  'ATAQUE policies: A no puede dar de alta una póliza con el producto de B (el caso "—")'
);

select is(
  pg_temp.attempt(format($q$ insert into products (agent_id, carrier_id, branch_id, name) values (%L, %L, %L, 'Cruzado') $q$,
         'a1a1a1a1-0000-4000-8000-00000000000a',
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'carriers'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'branches'))),
  '23503',
  'ATAQUE products: A no puede crear un producto con la aseguradora de B'
);

select is(
  pg_temp.attempt(format($q$ insert into policies (agent_id, contact_id, product_id, status_id, currency_id, policy_number)
                              values (%L, %L, %L, (select id from policy_statuses where code = 'ACTIVE'),
                                      (select id from currencies where code = 'MXN'), 'ISO-PROPIA') $q$,
         'a1a1a1a1-0000-4000-8000-00000000000a',
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'contacts'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'products'))),
  'ok:1',
  'CONTROL policies: A sí da de alta una póliza con su contacto y su producto'
);

select is(
  pg_temp.attempt(format($q$ insert into reminders (agent_id, contact_id, policy_id, type_id, status_id, title, due_date)
                              values (%L, %L, null, (select id from reminder_types where code = 'CALL'),
                                      (select id from reminder_statuses where code = 'CREATED'), 'Sin póliza', now()) $q$,
         'a1a1a1a1-0000-4000-8000-00000000000a',
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'contacts'))),
  'ok:1',
  'CONTROL reminders: A sí crea un recordatorio con su contacto y sin póliza (null)'
);

-- policy_participants no tiene agent_id: lo cubre un trigger.
select is(
  pg_temp.attempt(format($q$ insert into policy_participants (policy_id, contact_id, role_id)
                              values (%L, %L, (select id from participant_roles where code = 'INSURED')) $q$,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'policies'),
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'contacts'))),
  '23503',
  'ATAQUE policy_participants: A no puede poner al contacto de B como asegurado de su póliza'
);

select is(
  pg_temp.attempt(format($q$ update policy_participants set contact_id = %L where id = %L $q$,
         (select id from t_ids where agent = 'b2b2b2b2-0000-4000-8000-00000000000b' and tbl = 'contacts'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'policy_participants'))),
  '23503',
  'ATAQUE policy_participants: A no puede cambiar su participante al contacto de B'
);

select is(
  pg_temp.attempt(format($q$ insert into policy_participants (policy_id, contact_id, role_id)
                              values (%L, %L, (select id from participant_roles where code = 'INSURED')) $q$,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'policies'),
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'contacts'))),
  'ok:1',
  'CONTROL policy_participants: A sí agrega a su propio contacto'
);

select is(
  pg_temp.attempt(format($q$ insert into policy_participants (policy_id, contact_id, role_id)
                              values (%L, null, (select id from participant_roles where code = 'INSURED')) $q$,
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'policies'))),
  'ok:1',
  'CONTROL policy_participants: participante sin contacto (null) sigue permitido'
);

reset role;

-- Las FKs compuestas repiten el ON DELETE de la simple: borrar un padre
-- deja la nota sin contacto (set null SOLO de contact_id, no de agent_id) y
-- borrar una sesión se lleva sus mensajes. Como postgres (hard delete).
do $$
declare v_contact uuid; v_note uuid;
begin
  insert into contacts (agent_id, full_name) values ('a1a1a1a1-0000-4000-8000-00000000000a', 'Para borrar')
  returning id into v_contact;
  insert into agent_notes (agent_id, contact_id, source_type, content)
  values ('a1a1a1a1-0000-4000-8000-00000000000a', v_contact, 'text', 'nota huérfana') returning id into v_note;
  delete from contacts where id = v_contact;
  create temp table t_deleted_note on commit drop as
    select contact_id, agent_id from agent_notes where id = v_note;
end $$;

select results_eq(
  'select contact_id is null, agent_id::text from t_deleted_note',
  $$ values (true, 'a1a1a1a1-0000-4000-8000-00000000000a') $$,
  'CONTROL borrar contacto: la nota queda con contact_id null y conserva su agent_id'
);

select lives_ok(
  format('delete from ai_sessions where id = %L',
         (select id from t_ids where agent = 'a1a1a1a1-0000-4000-8000-00000000000a' and tbl = 'ai_sessions')),
  'CONTROL borrar sesión: cascada a mensajes, tareas y tokens sin chocar con la FK compuesta'
);

select pg_temp.login_as('a1a1a1a1-0000-4000-8000-00000000000a');

-- ═══ 7. Storage: bucket `policies`, carpeta = id del asesor ══════════════════

select is(
  (select count(*)::int from storage.objects
    where name like 'b2b2b2b2-0000-4000-8000-00000000000b/%'),
  0,
  'ATAQUE storage: A no ve los archivos de B'
);

select is(
  (select count(*)::int from storage.objects
    where name like 'a1a1a1a1-0000-4000-8000-00000000000a/%'),
  1,
  'CONTROL storage: A ve sus propios archivos'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('policies', 'b2b2b2b2-0000-4000-8000-00000000000b/plantado.pdf',
             'a1a1a1a1-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'ATAQUE storage: A no puede subir archivos a la carpeta de B'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('policies', 'a1a1a1a1-0000-4000-8000-00000000000a/nuevo.pdf',
             'a1a1a1a1-0000-4000-8000-00000000000a') $$,
  'CONTROL storage: A sí puede subir a su carpeta'
);

select matches(
  pg_temp.attempt($q$ update storage.objects
                         set name = 'a1a1a1a1-0000-4000-8000-00000000000a/robado.pdf'
                       where name = 'b2b2b2b2-0000-4000-8000-00000000000b/poliza.pdf' $q$),
  '^(ok:0|42501)$',
  'ATAQUE storage: A no puede mover a su carpeta un archivo de B'
);

select matches(
  pg_temp.attempt($q$ update storage.objects
                         set name = 'b2b2b2b2-0000-4000-8000-00000000000b/plantado.pdf'
                       where name = 'a1a1a1a1-0000-4000-8000-00000000000a/poliza.pdf' $q$),
  '^(ok:0|42501)$',
  'ATAQUE storage: A no puede mover un archivo suyo a la carpeta de B'
);

select matches(
  pg_temp.attempt($q$ delete from storage.objects
                       where name = 'b2b2b2b2-0000-4000-8000-00000000000b/poliza.pdf' $q$),
  '^(ok:0|42501)$',
  'ATAQUE storage: A no puede borrar archivos de B'
);

reset role;

-- ═══ 8. anon: nada de nada ═══════════════════════════════════════════════════

select pg_temp.login_anon();

select matches(
  pg_temp.visible(format('select count(*) from %I', tbl)),
  '^(0|42501)$',
  format('ANON %s: no ve ninguna fila', tbl))
from t_class order by tbl;

select is(
  pg_temp.attempt(format('insert into %I default values', tbl)),
  '42501',
  format('ANON %s: no puede insertar', tbl))
from t_class order by tbl;

select matches(
  pg_temp.attempt(format('delete from %I', tbl)),
  '^(ok:0|42501)$',
  format('ANON %s: no puede borrar', tbl))
from t_class order by tbl;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'policies'),
  0,
  'ANON storage: no ve ningún archivo del bucket policies'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('policies', 'b2b2b2b2-0000-4000-8000-00000000000b/anon.pdf') $$,
  '42501', null,
  'ANON storage: no puede subir archivos'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ═══ 9. Al final, los datos de B siguen intactos (como postgres) ═════════════

select is(
  pg_temp.visible(format('select count(*) from %I where id = %L %s', i.tbl, i.id,
    case when exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                        and c.table_name = i.tbl and c.column_name = 'is_active')
         then 'and is_active is not false' else '' end)),
  '1',
  format('INTACTO %s: la fila de B sigue ahí y activa', i.tbl))
from t_ids i where i.agent = 'b2b2b2b2-0000-4000-8000-00000000000b' order by i.tbl;

select is(
  (select full_name from agents where id = 'b2b2b2b2-0000-4000-8000-00000000000b'),
  'Iso B',
  'INTACTO agents: el perfil de B no cambió'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'b2b2b2b2-0000-4000-8000-00000000000b/poliza.pdf'),
  1,
  'INTACTO storage: el archivo de B sigue en su carpeta'
);

select * from finish();
rollback;
