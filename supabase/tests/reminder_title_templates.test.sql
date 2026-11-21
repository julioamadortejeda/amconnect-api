-- Pruebas de 20261121060000_reminder_title_templates (D-023).
-- Correr con: supabase test db
--
-- Columnas, backfill sobre un fixture (qué se convierte en plantilla y qué se
-- deja como texto del asesor), insert_generated_reminders con plantilla y la
-- búsqueda por cliente/producto/tipo con sinónimos.

begin;
select plan(19);

-- ─── Columnas ────────────────────────────────────────────────────────────────
select has_column('public', 'reminders', 'title_template', 'reminders.title_template existe');
select has_column('public', 'reminders', 'template_data', 'reminders.template_data existe');

-- ─── Fixture (como postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'asesor.tpl@test.local', '{"full_name":"Asesor T"}');

insert into carriers (id, agent_id, name) values
  ('ca000000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333', 'Seguros Atlas');
insert into branches (id, agent_id, name, code) values
  ('b0000000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333', 'Gastos Médicos Mayores', 'MAJOR_MEDICAL');
insert into products (id, agent_id, carrier_id, branch_id, name) values
  ('a0000000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333',
   'ca000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'Alfa Medical Integro');
insert into contacts (id, agent_id, full_name) values
  ('c0000000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333', 'Rosa Martínez Hernández'),
  ('c0000000-0000-0000-0000-0000000000a2', '33333333-3333-3333-3333-333333333333', 'Carlos Ramírez Ortega');
insert into policies (id, agent_id, contact_id, product_id, status_id, currency_id, policy_number, premium)
values ('e0000000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333',
        'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1',
        (select id from policy_statuses where code = 'ACTIVE'),
        (select id from currencies where code = 'MXN'), 'GMM-2026-10451', 2850);

insert into reminders (id, agent_id, policy_id, contact_id, type_id, title, due_date, occurrence_date, status_id)
select v.id::uuid, '33333333-3333-3333-3333-333333333333', v.policy_id::uuid, v.contact_id::uuid,
       (select id from reminder_types where code = v.type_code), v.title,
       '2026-11-23T06:00:00Z', v.occ::date, (select id from reminder_statuses where code = 'CREATED')
from (values
  -- automático de pago, título viejo en español, sin contacto
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1', null, 'PAYMENT',
   'Pago de Prima · GMM-2026-10451', '2026-11-23'),
  -- automático de renovación, título viejo en inglés
  ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1', null, 'RENEWAL',
   'Renewal · GMM-2026-10451', '2027-05-04'),
  -- automático que el asesor reescribió: se queda como texto suyo
  ('d0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-0000000000a1', null, 'ANNIVERSARY',
   'Llevarle pastel a Rosa', '2027-05-04'),
  -- manual (sin ocurrencia) aunque el título se parezca: no se toca
  ('d0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-0000000000a1', null, 'PAYMENT',
   'Pago de Prima · GMM-2026-10451', null),
  -- cumpleaños automático
  ('d0000000-0000-0000-0000-000000000005', null, 'c0000000-0000-0000-0000-0000000000a2', 'BIRTHDAY',
   'Cumpleaños · Carlos Ramírez Ortega', '2026-11-22')
) as v(id, policy_id, contact_id, type_code, title, occ);

-- ─── Backfill ────────────────────────────────────────────────────────────────
select results_eq(
  'select contacts_linked, templates_set from backfill_reminder_title_templates()',
  $$ values (3, 3) $$,
  'backfill: 3 automáticos de póliza ligados al titular, 3 plantillas (pago, renovación, cumpleaños)'
);

select is((select title_template from reminders where id = 'd0000000-0000-0000-0000-000000000001'),
  'PAYMENT_DUE', 'pago con título viejo en español → PAYMENT_DUE');
select is((select template_data from reminders where id = 'd0000000-0000-0000-0000-000000000001'),
  '{"dueDate": "2026-11-23", "amount": 2850.00, "currency": "MXN"}'::jsonb,
  'pago: fecha, monto y moneda; sin nombres');
select is((select contact_id from reminders where id = 'd0000000-0000-0000-0000-000000000001'),
  'c0000000-0000-0000-0000-0000000000a1'::uuid, 'pago: contact_id = titular de la póliza');
select is((select title_template from reminders where id = 'd0000000-0000-0000-0000-000000000002'),
  'RENEWAL', 'renovación con título viejo en inglés → RENEWAL');
select is((select template_data from reminders where id = 'd0000000-0000-0000-0000-000000000002'),
  '{"dueDate": "2027-05-04"}'::jsonb, 'renovación: solo la fecha');
select is((select title_template from reminders where id = 'd0000000-0000-0000-0000-000000000003'),
  null, 'título reescrito por el asesor: sin plantilla (D-021)');
select is((select title_template from reminders where id = 'd0000000-0000-0000-0000-000000000004'),
  null, 'manual (sin occurrence_date): sin plantilla');
select is((select contact_id from reminders where id = 'd0000000-0000-0000-0000-000000000004'),
  null, 'manual: su contact_id no se toca');
select is((select title_template from reminders where id = 'd0000000-0000-0000-0000-000000000005'),
  'BIRTHDAY', 'cumpleaños con título viejo → BIRTHDAY');

select results_eq(
  'select contacts_linked, templates_set from backfill_reminder_title_templates()',
  $$ values (0, 0) $$,
  'backfill re-ejecutable: la segunda corrida no cambia nada'
);

select throws_ok(
  $$ update reminders set title_template = 'NOPE' where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'title_template solo acepta las plantillas conocidas'
);

-- ─── insert_generated_reminders ──────────────────────────────────────────────
select is(
  (select count(*)::int from insert_generated_reminders(jsonb_build_array(jsonb_build_object(
    'agent_id', '33333333-3333-3333-3333-333333333333',
    'policy_id', 'e0000000-0000-0000-0000-0000000000a1',
    'contact_id', 'c0000000-0000-0000-0000-0000000000a1',
    'type_id', (select id from reminder_types where code = 'PAYMENT'),
    'title', 'Pago · Alfa Medical Integro · Rosa Martínez Hernández',
    'title_template', 'PAYMENT_DUE',
    'template_data', '{"dueDate":"2026-12-23","amount":2850}'::jsonb,
    'due_date', '2026-12-23T00:00:00-06:00',
    'occurrence_date', '2026-12-23',
    'status_id', (select id from reminder_statuses where code = 'CREATED')
  )))),
  1, 'insert_generated_reminders inserta con plantilla'
);
select is(
  (select title_template || ' ' || (template_data->>'dueDate') from reminders
    where agent_id = '33333333-3333-3333-3333-333333333333' and occurrence_date = '2026-12-23'),
  'PAYMENT_DUE 2026-12-23', 'insert_generated_reminders guarda title_template y template_data'
);

-- ─── Búsqueda (como el asesor) ───────────────────────────────────────────────
create or replace function pg_temp.found(p_query text) returns uuid[]
language sql as $$
  select coalesce(array_agg(id order by id), '{}')
  from search_reminder_ids('33333333-3333-3333-3333-333333333333', p_query) as id
  where id::text like 'd0000000%';
$$;
grant execute on function pg_temp.found(text) to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(pg_temp.found('pago rosa'),
  array['d0000000-0000-0000-0000-000000000001']::uuid[],
  '"pago rosa": por tipo y por el nombre del titular (su título guardado no dice "Rosa"; el manual sin contacto no entra)');
select is(pg_temp.found('payment Rosa'),
  array['d0000000-0000-0000-0000-000000000001']::uuid[],
  '"payment Rosa": sinónimo en inglés');
select is(pg_temp.found('cumpleaños carlos'),
  array['d0000000-0000-0000-0000-000000000005']::uuid[],
  '"cumpleaños carlos": tipo + contacto');

reset role;
select * from finish();
rollback;
