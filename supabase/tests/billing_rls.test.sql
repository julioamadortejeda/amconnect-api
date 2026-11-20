-- Pruebas del blindaje de facturación (migración 20261120233842_billing_rls_hardening).
-- Correr con: supabase test db
--
-- Cada prueba de "ataque" se hace como un asesor autenticado con su propio JWT,
-- igual que lo haría alguien que toma su token y le habla directo al Data API.

begin;
select plan(24);

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'asesor.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'asesor.b@test.local', '{"full_name":"Asesor B"}');

insert into promo_codes (code, trial_days) values ('PRUEBA30', 30);

-- Simula una sesión autenticada del asesor indicado.
create or replace function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- El trigger de auth.users creó los perfiles en trial.
select is(
  (select subscription_status from agents where id = '11111111-1111-1111-1111-111111111111'),
  'trial',
  'el alta crea al asesor en trial'
);

-- ─── Perfil: lo legítimo sigue funcionando ───────────────────────────────────

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update agents set full_name = 'Asesor A editado', phone = '5550000000'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'el asesor puede editar su nombre y teléfono'
);

select lives_ok(
  $$ update agents set timezone = 'America/Mexico_City', locale = 'es'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'el asesor puede guardar su zona horaria e idioma'
);

select is(
  (select count(*)::int from agents),
  1,
  'el asesor solo ve su propio perfil'
);

-- ─── Ataques al perfil ───────────────────────────────────────────────────────

select throws_ok(
  $$ update agents set subscription_status = 'active'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede activarse la suscripción'
);

select throws_ok(
  $$ update agents set trial_ends_at = '2099-01-01'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede alargarse el trial'
);

select throws_ok(
  $$ update agents set plan_id = null, promo_code_used = null
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede cambiar su plan ni borrar el código usado'
);

select throws_ok(
  $$ delete from agents where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede borrar su perfil por la API'
);

-- ─── Cuota: lo legítimo ──────────────────────────────────────────────────────

create temp table t_charge on commit drop as
  select (increment_monthly_usage('11111111-1111-1111-1111-111111111111', 'chat')->>'charge_id')::uuid as id;

select isnt(
  (select id from t_charge),
  null,
  'cobrar un mensaje devuelve el id del cobro'
);

select is(
  (select chat_count from agent_monthly_usage
    where agent_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'el contador del mes sube a 1 y el asesor lo puede leer'
);

-- ─── Ataques a la cuota ──────────────────────────────────────────────────────

select throws_ok(
  $$ update agent_monthly_usage set chat_count = 0
     where agent_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede poner su contador en cero'
);

select throws_ok(
  $$ insert into agent_monthly_usage (agent_id, year_month, chat_count, ingestion_count)
     values ('11111111-1111-1111-1111-111111111111', '2000-01-01', 0, 0) $$,
  '42501', null,
  'ATAQUE: el asesor no puede insertar filas de uso'
);

select throws_ok(
  $$ select increment_monthly_usage('22222222-2222-2222-2222-222222222222', 'chat') $$,
  '42501', null,
  'ATAQUE: el asesor no puede cobrarle cuota a otro asesor'
);

select hasnt_function(
  'public', 'decrement_monthly_usage', array['uuid', 'text'],
  'ATAQUE: ya no existe la función que bajaba el contador a voluntad'
);

-- ─── Devolución de cuota ─────────────────────────────────────────────────────

select is(
  refund_usage_charge((select id from t_charge)),
  true,
  'devolver un cobro propio y reciente funciona'
);

select is(
  (select chat_count from agent_monthly_usage
    where agent_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'la devolución baja el contador'
);

select is(
  refund_usage_charge((select id from t_charge)),
  false,
  'ATAQUE: el mismo cobro no se puede devolver dos veces'
);

select is(
  refund_usage_charge(gen_random_uuid()),
  false,
  'ATAQUE: devolver un cobro inventado no hace nada'
);

-- ─── Código promocional ──────────────────────────────────────────────────────

select throws_ok(
  $$ select apply_promo_code('22222222-2222-2222-2222-222222222222', 'PRUEBA30') $$,
  '42501', null,
  'ATAQUE: el asesor no puede aplicarle un código a otro asesor'
);

select lives_ok(
  $$ select apply_promo_code('11111111-1111-1111-1111-111111111111', 'prueba30') $$,
  'el asesor aplica un código válido'
);

select throws_like(
  $$ select apply_promo_code('11111111-1111-1111-1111-111111111111', 'PRUEBA30') $$,
  '%promo_already_used%',
  'ATAQUE: el mismo asesor no puede reaplicar un código (trial infinito)'
);

-- ─── Tablas de registro ──────────────────────────────────────────────────────

select throws_ok(
  $$ delete from tokens_usage where agent_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ATAQUE: el asesor no puede borrar su registro de consumo de tokens'
);

select throws_ok(
  $$ insert into reminder_notifications (reminder_id, agent_id, due_date_at_send)
     values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', now()) $$,
  '42501', null,
  'ATAQUE: el asesor no puede escribir en el log de notificaciones'
);

-- ─── service_role (cron, webhook futuro) conserva el acceso ──────────────────

reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

select lives_ok(
  $$ select increment_monthly_usage('22222222-2222-2222-2222-222222222222', 'chat') $$,
  'service_role puede operar la cuota de cualquier asesor'
);

select * from finish();
rollback;
