-- Pruebas del límite por minuto (migración 20261121212011_rate_limit, D-027).
-- Correr con: supabase test db
--
-- now() es fijo dentro de la transacción, así que "pasar el tiempo" se simula
-- moviendo hacia atrás el window_start de las filas (como postgres).

begin;
select plan(25);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('5a5a5a5a-0000-4000-8000-00000000000a', 'rl.a@test.local', '{"full_name":"RL A"}'),
  ('5b5b5b5b-0000-4000-8000-00000000000b', 'rl.b@test.local', '{"full_name":"RL B"}');

create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create or replace function pg_temp.login_anon() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
$$;

-- Consume n veces y devuelve cuántas pasaron.
create or replace function pg_temp.consume_n(p_bucket text, p_limit int, p_n int) returns int
language plpgsql as $$
declare
  ok int := 0;
begin
  for i in 1..p_n loop
    if (consume_rate_limit(p_bucket, p_limit, 60) ->> 'allowed')::boolean then
      ok := ok + 1;
    end if;
  end loop;
  return ok;
end;
$$;

grant execute on function pg_temp.login_as(uuid) to authenticated, anon;
grant execute on function pg_temp.login_anon() to authenticated, anon;
grant execute on function pg_temp.consume_n(text, int, int) to authenticated, anon;

-- ─── Conteo ──────────────────────────────────────────────────────────────────

select pg_temp.login_as('5a5a5a5a-0000-4000-8000-00000000000a');

select is((consume_rate_limit('ai', 3, 60) ->> 'allowed')::boolean, true, 'la 1a petición pasa');
select is((consume_rate_limit('ai', 3, 60) ->> 'remaining')::int, 1, 'remaining baja con cada petición (tras la 2a de 3 queda 1)');
select is(pg_temp.consume_n('ai', 3, 1), 1, 'la 3a petición pasa (justo el límite)');

select is((consume_rate_limit('ai', 3, 60) ->> 'allowed')::boolean, false, 'la 4a petición se rechaza');
select ok((consume_rate_limit('ai', 3, 60) ->> 'retryAfterSeconds')::int between 1 and 120,
  'el rechazo trae retryAfterSeconds entre 1 y 2 ventanas');

select is(pg_temp.consume_n('general', 5, 7), 5, 'buckets independientes: general deja pasar sus 5 aunque ai esté lleno');

reset role;
select is(
  (select request_count from rate_limit_buckets
    where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai'),
  3,
  'las peticiones rechazadas no se cuentan (el contador queda en el límite)'
);

-- ─── Aislamiento entre asesores ──────────────────────────────────────────────

select pg_temp.login_as('5b5b5b5b-0000-4000-8000-00000000000b');
select is(pg_temp.consume_n('ai', 3, 3), 3, 'B tiene su propio contador: el bloqueo de A no lo afecta');

select throws_ok(
  $$ select count(*) from rate_limit_buckets $$,
  '42501', null,
  'B no puede leer la tabla (ni sus filas ni las de A)'
);

select throws_ok(
  $$ update rate_limit_buckets set request_count = 0 $$,
  '42501', null,
  'B no puede reiniciar contadores escribiendo la tabla'
);

select throws_ok(
  $$ delete from rate_limit_buckets $$,
  '42501', null,
  'B no puede borrar contadores'
);

select throws_ok(
  $$ insert into rate_limit_buckets (agent_id, bucket, window_seconds, window_start, request_count)
     values ('5a5a5a5a-0000-4000-8000-00000000000a', 'ai', 60, now(), 999) $$,
  '42501', null,
  'B no puede llenarle el contador a A insertando filas'
);

-- B llamando con otra ventana o límite solo toca filas suyas.
select lives_ok($$ select consume_rate_limit('ai', 1000, 1) $$, 'B puede llamar con otra ventana (solo le suma a él)');

reset role;
select is(
  (select request_count from rate_limit_buckets
    where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai' and window_seconds = 60),
  3,
  'nada de lo que hizo B cambió el contador de A'
);
select is(
  (select count(*)::int from rate_limit_buckets where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a'),
  2,
  'A solo tiene sus dos filas (ai y general)'
);

-- ─── Llamadas inválidas ──────────────────────────────────────────────────────

select pg_temp.login_anon();
select throws_ok($$ select consume_rate_limit('ai', 20, 60) $$, '42501', null,
  'anon no puede ejecutar la función');

select pg_temp.login_as('5a5a5a5a-0000-4000-8000-00000000000a');
select throws_ok($$ select consume_rate_limit('otro', 20, 60) $$, '22023', null,
  'bucket desconocido se rechaza (no crece la tabla con nombres arbitrarios)');
select throws_ok($$ select consume_rate_limit('ai', 20, 0) $$, '22023', null,
  'ventana fuera de rango se rechaza');
select throws_ok($$ select purge_rate_limit_buckets() $$, '42501', null,
  'el asesor no puede ejecutar el barrido');

-- ─── Ventana deslizante ──────────────────────────────────────────────────────
-- La ventana llena de A pasa a ser la ANTERIOR: todavía pesa, así que no se
-- abre de golpe todo el cupo como en una ventana fija.

reset role;
update rate_limit_buckets
   set window_start = window_start - interval '60 seconds'
 where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai';

select pg_temp.login_as('5a5a5a5a-0000-4000-8000-00000000000a');
select ok(pg_temp.consume_n('ai', 3, 3) < 3,
  'justo después del cambio de ventana la anterior aún pesa (no se abren las 3 de golpe)');

-- Dos ventanas después, la anterior ya no cuenta: cupo completo.
reset role;
delete from rate_limit_buckets
 where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai'
   and window_start = date_bin(interval '60 seconds', now(), timestamptz 'epoch');
update rate_limit_buckets
   set window_start = window_start - interval '120 seconds'
 where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai';

select pg_temp.login_as('5a5a5a5a-0000-4000-8000-00000000000a');
select is(pg_temp.consume_n('ai', 3, 4), 3, 'pasadas dos ventanas el cupo se reinicia completo');

-- ─── Barrido ─────────────────────────────────────────────────────────────────

reset role;
select ok(
  exists (select 1 from rate_limit_buckets
           where window_start < now() - make_interval(secs => 2 * window_seconds)),
  'hay al menos una ventana vieja antes del barrido'
);
select ok(purge_rate_limit_buckets() >= 1, 'el barrido borra las ventanas viejas');
select is(
  (select count(*)::int from rate_limit_buckets
    where window_start < now() - make_interval(secs => 2 * window_seconds)),
  0,
  'no queda ninguna ventana vieja'
);
select is(
  (select request_count from rate_limit_buckets
    where agent_id = '5a5a5a5a-0000-4000-8000-00000000000a' and bucket = 'ai'
      and window_start = date_bin(interval '60 seconds', now(), timestamptz 'epoch')),
  3,
  'la ventana actual sobrevive al barrido'
);

select * from finish();
rollback;
