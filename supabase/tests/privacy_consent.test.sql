-- Pruebas del consentimiento de privacidad (migración 20261121005113_privacy_consent).
-- Correr con: supabase test db

begin;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'asesor.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'asesor.b@test.local', '{"full_name":"Asesor B"}');

create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select is(
  (select privacy_accepted_version from agents where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'un asesor nuevo no ha aceptado ninguna versión'
);

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select accept_privacy_policy('2026-11-v1') $$,
  'el asesor puede aceptar el aviso para sí mismo'
);

select is(
  (select privacy_accepted_version from agents where id = '11111111-1111-1111-1111-111111111111'),
  '2026-11-v1',
  'queda guardada la versión aceptada'
);

select isnt(
  (select privacy_accepted_at from agents where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'queda guardada la fecha de aceptación'
);

select throws_ok(
  $$ update agents set privacy_accepted_version = 'inventada'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede escribir la versión por el Data API'
);

select throws_ok(
  $$ update agents set privacy_accepted_at = '2000-01-01'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede escribir la fecha por el Data API'
);

select throws_ok(
  $$ select accept_privacy_policy('  ') $$,
  '22023', null,
  'una versión vacía se rechaza'
);

reset role;
select is(
  (select privacy_accepted_version from agents where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'aceptar no toca a otros asesores'
);

-- Sin uid en el JWT (p. ej. service_role sin sub) no hay a quién aceptarle nada.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select throws_ok(
  $$ select accept_privacy_policy('2026-11-v1') $$,
  '42501', null,
  'sin uid en el JWT se rechaza con 42501'
);

reset role;
set local role anon;
select throws_ok(
  $$ select accept_privacy_policy('2026-11-v1') $$,
  '42501', null,
  'anon no puede ejecutar accept_privacy_policy'
);

select * from finish();
rollback;
