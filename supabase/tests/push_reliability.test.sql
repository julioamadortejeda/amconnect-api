-- Pruebas de push y job nocturno confiables (migración 20261121002508_push_reliability).
-- Correr con: supabase test db

begin;
select plan(22);

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'push.a@test.local', '{"full_name":"Push A"}'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'push.b@test.local', '{"full_name":"Push B"}');

insert into contacts (id, agent_id, full_name, birthdate)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111', 'Cliente Uno', '1980-05-10');

-- Dos recordatorios vencidos del asesor A, uno futuro y uno ya HECHO.
insert into reminders (id, agent_id, contact_id, type_id, title, due_date, status_id)
select v.id::uuid, 'aaaaaaaa-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
       (select id from reminder_types where code = 'CALL'), v.title, v.due::timestamptz,
       (select id from reminder_statuses where code = v.status)
  from (values
    ('dddddddd-0000-0000-0000-000000000001', 'vencido 1', now() - interval '2 hours', 'CREATED'),
    ('dddddddd-0000-0000-0000-000000000002', 'vencido 2', now() - interval '1 hour',  'IN_PROGRESS'),
    ('dddddddd-0000-0000-0000-000000000003', 'futuro',    now() + interval '1 day',   'CREATED'),
    ('dddddddd-0000-0000-0000-000000000004', 'hecho',     now() - interval '1 hour',  'DONE')
  ) as v(id, title, due, status);

-- Simula una sesión autenticada del asesor indicado.
create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- ─── Reclamo atómico de recordatorios vencidos ───────────────────────────────

-- La BD local puede tener otros vencidos: se miran solo los de este asesor.
create temp table claim1 as select * from claim_due_reminders(1000, 300, 6)
 where agent_id = 'aaaaaaaa-1111-1111-1111-111111111111';
create temp table claim2 as select * from claim_due_reminders(1000, 300, 6)
 where agent_id = 'aaaaaaaa-1111-1111-1111-111111111111';

select set_eq(
  $$ select id from claim1 $$,
  $$ values ('dddddddd-0000-0000-0000-000000000001'::uuid), ('dddddddd-0000-0000-0000-000000000002'::uuid) $$,
  'el reclamo devuelve solo los vencidos abiertos (ni futuros ni HECHOS)'
);

select is(
  (select count(*)::int from claim2),
  0,
  'un segundo reclamo no devuelve las filas que ya tomó el primero'
);

select is(
  (select count(*)::int from claim1 c join claim2 d on d.id = c.id),
  0,
  'dos reclamos nunca comparten una fila'
);

select is(
  (select count(*)::int from reminders where id in (select id from claim1) and notified_at is not null),
  0,
  'reclamar no marca como notificado'
);

-- El lease vence (la corrida murió o FCM falló): la fila se vuelve a tomar.
update reminder_push_deliveries
   set claimed_at = now() - interval '10 minutes'
 where reminder_id = 'dddddddd-0000-0000-0000-000000000001';

select is(
  (select attempts from claim_due_reminders(100, 300, 6)
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  2,
  'con el lease vencido se reintenta y cuenta el intento'
);

-- Tope de intentos.
update reminder_push_deliveries
   set claimed_at = now() - interval '10 minutes', attempts = 6
 where reminder_id = 'dddddddd-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from claim_due_reminders(100, 300, 6)
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'al llegar al tope de intentos ya no se reclama'
);

-- Uno que ya se envió no se vuelve a reclamar aunque venza su lease.
update reminder_push_deliveries
   set claimed_at = now() - interval '10 minutes', sent_at = now()
 where reminder_id = 'dddddddd-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from claim_due_reminders(100, 300, 6)
    where id = 'dddddddd-0000-0000-0000-000000000002'),
  0,
  'lo ya enviado no se reclama de nuevo'
);

-- Reagendar reinicia la entrega: la fecha nueva empieza con intentos en 1.
update reminders
   set due_date = now() - interval '5 minutes'
 where id = 'dddddddd-0000-0000-0000-000000000001';

select is(
  (select attempts from claim_due_reminders(100, 300, 6)
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  1,
  'un recordatorio reagendado vuelve a ser elegible desde cero'
);

-- El asesor no puede usar el reclamo ni ver el estado de entrega.
select pg_temp.login_as('aaaaaaaa-1111-1111-1111-111111111111');

select throws_ok(
  $$ select * from claim_due_reminders(100, 300, 6) $$,
  '42501', null,
  'ATAQUE: el asesor no puede ejecutar el reclamo del cron'
);

select throws_ok(
  $$ select * from reminder_push_deliveries $$,
  '42501', null,
  'el asesor no puede leer el estado de entrega'
);

reset role;

-- ─── Tokens de dispositivo: un token, un dueño ───────────────────────────────

select pg_temp.login_as('aaaaaaaa-1111-1111-1111-111111111111');

select is(
  (select agent_id from claim_device_token('token-dispositivo-1', 'ios')),
  'aaaaaaaa-1111-1111-1111-111111111111'::uuid,
  'el asesor A registra su dispositivo'
);

reset role;
select pg_temp.login_as('bbbbbbbb-2222-2222-2222-222222222222');

-- B inicia sesión en el mismo teléfono sin que A haya cerrado sesión.
select is(
  (select agent_id from claim_device_token('token-dispositivo-1', 'ios')),
  'bbbbbbbb-2222-2222-2222-222222222222'::uuid,
  'el mismo dispositivo pasa al asesor B'
);

reset role;

select is(
  (select count(*)::int from agent_device_tokens where token = 'token-dispositivo-1'),
  1,
  'el token queda registrado una sola vez'
);

select is(
  (select agent_id from agent_device_tokens where token = 'token-dispositivo-1'),
  'bbbbbbbb-2222-2222-2222-222222222222'::uuid,
  'el push de A ya no llega al dispositivo que ahora usa B'
);

select throws_ok(
  $$ insert into agent_device_tokens (agent_id, token, platform)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'token-dispositivo-1', 'ios') $$,
  '23505', null,
  'la BD impide el mismo token para dos asesores'
);

-- Sin sesión (anon, o service role sin uid) nadie puede reclamar tokens.
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select * from claim_device_token('token-x', 'ios') $$,
  '42501', null,
  'sin auth.uid() no se puede reclamar un token'
);

set local role anon;
select throws_ok(
  $$ select * from claim_device_token('token-x', 'ios') $$,
  '42501', null,
  'ATAQUE: anon no puede ejecutar claim_device_token'
);
reset role;

-- ─── Job nocturno: idempotente y respeta lo que el asesor borró ──────────────

create temp table gen_rows as
select jsonb_build_array(jsonb_build_object(
  'agent_id', 'aaaaaaaa-1111-1111-1111-111111111111',
  'contact_id', 'cccccccc-0000-0000-0000-000000000001',
  'type_id', (select id from reminder_types where code = 'BIRTHDAY'),
  'title', 'Cumpleaños · Cliente Uno',
  'due_date', '2027-05-10T00:00:00-06:00',
  'occurrence_date', '2027-05-10',
  'status_id', (select id from reminder_statuses where code = 'CREATED')
)) as rows;
grant select on gen_rows to authenticated;

select pg_temp.login_as('aaaaaaaa-1111-1111-1111-111111111111');

select is(
  (select is_new from insert_generated_reminders((select rows from gen_rows))),
  true,
  'la primera corrida crea el recordatorio de la ocurrencia'
);

select is(
  (select is_new from insert_generated_reminders((select rows from gen_rows))),
  false,
  'la segunda corrida lo encuentra en vez de duplicarlo'
);

-- El asesor lo borra (soft delete).
update reminders set is_active = false, deleted_at = now()
 where occurrence_date = '2027-05-10'
   and contact_id = 'cccccccc-0000-0000-0000-000000000001';

select is(
  (select is_new from insert_generated_reminders((select rows from gen_rows))),
  false,
  'el job no regenera un recordatorio que el asesor borró'
);

reset role;

select is(
  (select count(*)::int from reminders
    where occurrence_date = '2027-05-10'
      and contact_id = 'cccccccc-0000-0000-0000-000000000001'),
  1,
  'sigue habiendo una sola fila para esa ocurrencia'
);

select throws_ok(
  $$ insert into reminders (agent_id, contact_id, type_id, title, due_date, occurrence_date, status_id)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
             (select id from reminder_types where code = 'BIRTHDAY'), 'dup',
             '2027-05-10T00:00:00-06:00', '2027-05-10',
             (select id from reminder_statuses where code = 'CREATED')) $$,
  '23505', null,
  'el índice único impide duplicar la ocurrencia aunque se salte la función'
);

select * from finish();
rollback;
