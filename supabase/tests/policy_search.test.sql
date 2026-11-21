-- Pruebas de la búsqueda de pólizas (migración 20261121002454_policy_search).
-- Correr con: supabase test db
--
-- Cada consulta es una frase que el asesor dice de verdad y que la búsqueda
-- vieja (includes de la frase completa, en memoria) no encontraba.

begin;
select plan(18);

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'asesor.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'asesor.b@test.local', '{"full_name":"Asesor B"}');

-- Catálogo del asesor A: ramos guardados EN INGLÉS, como los deja la app.
insert into carriers (id, agent_id, name) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'AXA Seguros'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'GNP Seguros'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Seguros Monterrey New York Life, S.A. De C.V.'),
  ('ca000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'AXA Seguros');

insert into branches (id, agent_id, name, code) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Major Medical', 'MAJOR_MEDICAL'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Automobile',    'AUTO'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Life',          'LIFE'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Property',      'PROPERTY'),
  ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Major Medical', 'MAJOR_MEDICAL');

insert into products (id, agent_id, carrier_id, branch_id, name) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Flex Plus'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Auto Integral'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Vida Mujer'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', 'Hogar Versátil'),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Línea Azul'),
  ('a0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'ca000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Flex Plus');

insert into contacts (id, agent_id, full_name) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pedro Ramírez Soto'),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'María de los Ángeles Muñoz'),
  ('c0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Pedro Gómez');

insert into policies (id, agent_id, contact_id, product_id, status_id, currency_id, policy_number, insured_item)
select v.id::uuid, v.agent_id::uuid, v.contact_id::uuid, v.product_id::uuid,
       (select id from policy_statuses where code = 'ACTIVE'),
       (select id from currencies where code = 'MXN'),
       v.policy_number, v.insured_item
from (values
  -- Pedro: GMM con AXA, y auto con GNP (el Jetta)
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'AX-778812', null),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'GA0004521', 'Volkswagen Jetta 2019'),
  -- María: auto, GMM con GNP, la casa de Pachuca y vida con SMNYL
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'GA0009988', 'Nissan Versa 2022'),
  ('e0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'GM1200', null),
  ('e0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'HG3300', 'Casa en Pachuca, Hidalgo'),
  ('e0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'VM5500', null),
  -- Asesor B: un GMM de AXA de otro Pedro
  ('e0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b', 'AX-999', null)
) as v(id, agent_id, contact_id, product_id, policy_number, insured_item);

create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- Ids que devuelve la búsqueda del asesor A, ordenados para comparar.
create or replace function pg_temp.found(p_query text, p_contact uuid default null) returns uuid[]
language sql as $$
  select coalesce(array_agg(id order by id), '{}')
  from search_policy_ids('11111111-1111-1111-1111-111111111111', p_query, p_contact) as id;
$$;

grant execute on function pg_temp.login_as(uuid) to authenticated;
grant execute on function pg_temp.found(text, uuid) to authenticated;

-- ─── Como el asesor A ────────────────────────────────────────────────────────

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select is(pg_temp.found('GMM de AXA'),
  array['e0000000-0000-0000-0000-000000000001'::uuid],
  '"GMM de AXA": cada palabra en un campo distinto, con el ramo guardado como Major Medical');

select is(pg_temp.found('gastos medicos'),
  array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004']::uuid[],
  '"gastos medicos" sin acento encuentra los dos GMM');

select is(pg_temp.found('gastos médicos'),
  array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004']::uuid[],
  '"gastos médicos" con acento encuentra los GMM aunque el ramo esté en inglés');

select is(pg_temp.found('health insurance'),
  array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004']::uuid[],
  '"health insurance" (sinónimo en inglés + palabra vacía en inglés) encuentra los GMM');

select is(pg_temp.found('Quálitas'),
  '{}'::uuid[],
  'una aseguradora que el asesor no tiene no devuelve nada (sin falsos positivos difusos)');

select is(pg_temp.found('jeta'),
  array['e0000000-0000-0000-0000-000000000002'::uuid],
  '"jeta" (typo) encuentra la del Jetta por insured_item');

select is(pg_temp.found('auto de Pedro'),
  array['e0000000-0000-0000-0000-000000000002'::uuid],
  '"auto de Pedro" filtra por contratante y deja fuera el auto de María');

select is(pg_temp.found('4521'),
  array['e0000000-0000-0000-0000-000000000002'::uuid],
  'número de póliza parcial');

select is(pg_temp.found('la casa de Pachuca'),
  array['e0000000-0000-0000-0000-000000000005'::uuid],
  '"la casa de Pachuca" por insured_item, sin palabras vacías');

select is(pg_temp.found('SMNYL'),
  array['e0000000-0000-0000-0000-000000000006'::uuid],
  '"SMNYL" encuentra Seguros Monterrey New York Life');

select is(pg_temp.found('seguro de vida de maria'),
  array['e0000000-0000-0000-0000-000000000006'::uuid],
  '"seguro de vida de maria": frase con sinónimo + contratante sin acento');

select is(pg_temp.found('coche', 'c0000000-0000-0000-0000-000000000002'),
  array['e0000000-0000-0000-0000-000000000003'::uuid],
  'acotada a un contacto: "coche" de María');

select is(pg_temp.found('rc'),
  '{}'::uuid[],
  '"rc" (sinónimo) no pega como subcadena con otras palabras');

select is(pg_temp.found('póliza'),
  array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
        'e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004',
        'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000006']::uuid[],
  'solo palabras vacías: no filtra (como las otras búsquedas)');

select is(
  (select id from search_policy_ids('11111111-1111-1111-1111-111111111111', 'GA0004521') as id limit 1),
  'e0000000-0000-0000-0000-000000000002'::uuid,
  'el número exacto va primero');

-- ─── Aislamiento entre asesores ──────────────────────────────────────────────

select is(pg_temp.found('AXA'),
  array['e0000000-0000-0000-0000-000000000001'::uuid],
  'el asesor A no ve el GMM de AXA del asesor B');

select is(
  (select count(*)::int from search_policy_ids('22222222-2222-2222-2222-222222222222', 'AXA')),
  0,
  'ATAQUE: pasando el agent_id de B, el RLS no le devuelve nada a A');

select pg_temp.login_as('22222222-2222-2222-2222-222222222222');

select is(
  (select array_agg(id) from search_policy_ids('22222222-2222-2222-2222-222222222222', 'pedro') as id),
  array['e0000000-0000-0000-0000-00000000000b'::uuid],
  'el asesor B solo ve a su propio Pedro');

select * from finish();
rollback;
