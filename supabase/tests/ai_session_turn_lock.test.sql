-- Candado de turno de ai_sessions (migración 20261122064126_ai_sessions_turn_lock).
-- Correr con: supabase test db
begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'asesor.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'asesor.b@test.local', '{"full_name":"Asesor B"}');

insert into ai_sessions (id, agent_id, trigger_message)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'sesión de A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'sesión de B');

create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- Mismo UPDATE condicional que usa la app; devuelve cuántas filas tomó.
create or replace function pg_temp.try_lock(p_id uuid) returns int language plpgsql as $$
declare n int;
begin
  update ai_sessions set turn_locked_until = now() + interval '120 seconds'
   where id = p_id and (turn_locked_until is null or turn_locked_until < now());
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function pg_temp.try_release(p_id uuid) returns int language plpgsql as $$
declare n int;
begin
  update ai_sessions set turn_locked_until = null where id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select is(
  pg_temp.try_lock('aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'el asesor toma el candado de su propia sesión'
);

select is(
  pg_temp.try_lock('aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'con el candado vigente, un segundo intento no toma ninguna fila'
);

select is(
  pg_temp.try_lock('bbbbbbbb-0000-4000-8000-000000000002'),
  0, 'ATAQUE: el asesor A no puede bloquear la sesión del asesor B'
);

select is(
  pg_temp.try_release('bbbbbbbb-0000-4000-8000-000000000002'),
  0, 'ATAQUE: el asesor A no puede liberar el candado de la sesión de B'
);

select lives_ok(
  $$ update ai_sessions set turn_locked_until = null
      where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'el asesor libera su propio candado'
);

reset role;
select is(
  (select turn_locked_until from ai_sessions where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  null::timestamptz, 'la sesión de B quedó intacta'
);

select * from finish();
rollback;
