-- Pruebas del consentimiento de privacidad y su evidencia
-- (migraciones 20261121005113_privacy_consent y 20261121005725_privacy_consent_evidence).
-- Correr con: supabase test db

begin;
select plan(26);

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

select hasnt_function('public', 'accept_privacy_policy', array['text'],
  'la función vieja sin evidencia ya no existe');

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select record_privacy_consent('2026-11-v1', true, true, '203.0.113.7', 'AmConnect/1.4 iOS', '1.4.0+23', 'ios', 'es') $$,
  'el asesor puede aceptar el aviso para sí mismo'
);

select is(
  (select privacy_accepted_version from agents where id = '11111111-1111-1111-1111-111111111111'),
  '2026-11-v1',
  'queda guardada la versión aceptada en agents'
);

select isnt(
  (select privacy_accepted_at from agents where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'queda guardada la fecha de aceptación en agents'
);

select is(
  (select count(*)::int from privacy_consents),
  1,
  'se insertó una fila de evidencia'
);

select is(
  (select row(version, accepted_notice, accepted_sensitive, host(ip), user_agent, app_version, platform, locale)::text
     from privacy_consents),
  '(2026-11-v1,t,t,203.0.113.7,"AmConnect/1.4 iOS",1.4.0+23,ios,es)',
  'la evidencia guarda versión, casillas, IP, user-agent, app, plataforma e idioma'
);

select is(
  (select accepted_at = (select privacy_accepted_at from agents where id = '11111111-1111-1111-1111-111111111111')
     from privacy_consents),
  true,
  'la fecha de la evidencia coincide con la de agents (hora del servidor)'
);

-- Re-aceptación: otra fila, la historia se conserva.
select lives_ok(
  $$ select record_privacy_consent('2026-12-v2', true, true, '2001:db8::1', 'ua', null, 'android', 'en') $$,
  'el asesor puede volver a aceptar (versión nueva)'
);

select is((select count(*)::int from privacy_consents), 2, 'la segunda aceptación agrega una fila, no reemplaza');

select is(
  (select privacy_accepted_version from agents where id = '11111111-1111-1111-1111-111111111111'),
  '2026-12-v2',
  'agents refleja la última versión'
);

-- IP inválida: se acepta y se guarda null.
select lives_ok(
  $$ select record_privacy_consent('2026-12-v2', true, true, 'no-es-una-ip', repeat('x', 800), 'x', 'plan9', 'es') $$,
  'una IP mal formada no hace fallar la aceptación'
);

select is(
  (select row(ip is null, length(user_agent), platform is null)::text
     from privacy_consents where app_version = 'x'),
  '(t,500,t)',
  'IP inválida queda null, user-agent truncado a 500, plataforma desconocida null'
);

-- Ambas casillas son obligatorias.
select throws_ok(
  $$ select record_privacy_consent('2026-11-v1', false, true, null, null, null, null, null) $$,
  '22023', null, 'sin aviso aceptado se rechaza');
select throws_ok(
  $$ select record_privacy_consent('2026-11-v1', true, false, null, null, null, null, null) $$,
  '22023', null, 'sin datos sensibles aceptados se rechaza');
select throws_ok(
  $$ select record_privacy_consent('2026-11-v1', true, null, null, null, null, null, null) $$,
  '22023', null, 'una casilla null se rechaza');
select throws_ok(
  $$ select record_privacy_consent('  ', true, true, null, null, null, null, null) $$,
  '22023', null, 'una versión vacía se rechaza');

-- Append-only: el asesor no escribe directo.
select throws_ok(
  $$ insert into privacy_consents (agent_id, version, accepted_notice, accepted_sensitive)
     values ('11111111-1111-1111-1111-111111111111', 'x', true, true) $$,
  '42501', null, 'ATAQUE: el asesor no puede insertar evidencia directo');
select throws_ok(
  $$ update privacy_consents set version = 'otra' $$,
  '42501', null, 'ATAQUE: el asesor no puede modificar evidencia');
select throws_ok(
  $$ delete from privacy_consents $$,
  '42501', null, 'ATAQUE: el asesor no puede borrar evidencia');

select throws_ok(
  $$ update agents set privacy_accepted_version = 'inventada'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede escribir la versión por el Data API'
);

-- Aislamiento.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from privacy_consents),
  0,
  'otro asesor no ve la evidencia ajena'
);

reset role;
select is(
  (select privacy_accepted_version from agents where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'aceptar no toca a otros asesores'
);

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select throws_ok(
  $$ select record_privacy_consent('2026-11-v1', true, true, null, null, null, null, null) $$,
  '42501', null,
  'sin uid en el JWT se rechaza con 42501'
);

reset role;
set local role anon;
select throws_ok(
  $$ select record_privacy_consent('2026-11-v1', true, true, null, null, null, null, null) $$,
  '42501', null,
  'anon no puede ejecutar record_privacy_consent'
);
select throws_ok(
  $$ select count(*) from privacy_consents $$,
  '42501', null,
  'anon no puede leer la evidencia'
);

select * from finish();
rollback;
