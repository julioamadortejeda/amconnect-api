-- Cierra el hueco de facturación encontrado en la auditoría del 2026-11-20.
--
-- Antes: el asesor podía, con su propio JWT y la anon key que viene en la app,
--   - editar su fila de `agents` completa (subscription_status, plan_id,
--     trial_ends_at, promo_code_used) y hasta borrarla — la policy era FOR ALL;
--   - escribir directo en `agent_monthly_usage` (poner su contador en 0);
--   - llamar `increment/decrement_monthly_usage` y `apply_promo_code` con el
--     `p_agent_id` de cualquiera (security definer sin revisar auth.uid());
--   - llamar `decrement_monthly_usage` sobre sí mismo en bucle → cuota infinita;
--   - reaplicar el mismo código promocional sin límite → trial infinito.
--
-- Después:
--   - del perfil solo se editan full_name, phone, timezone y locale (lo único
--     que escribe el backend en nombre del asesor);
--   - los contadores son de solo lectura; solo los mueven las funciones;
--   - cada cobro de cuota deja una fila en `usage_charges` y la devolución
--     exige ese id: una vez, del propio asesor y dentro de 15 minutos;
--   - las funciones verifican que el `p_agent_id` sea el del JWT (o service_role);
--   - un asesor aplica un código promocional una sola vez, y nunca sobre una
--     suscripción activa (lo devolvería a trial).
--
-- Los planes se siguen asignando a mano desde el panel / SQL Editor (postgres
-- no pasa por RLS ni por los grants de columnas) o, más adelante, desde el
-- webhook de la pasarela con service_role.

-- ─── agents: el asesor edita su perfil, nunca su suscripción ─────────────────

drop policy if exists "agents: own profile" on agents;

create policy "agents: read own profile"
  on agents for select to authenticated
  using (id = auth.uid());

create policy "agents: update own profile"
  on agents for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- La fila la crea el trigger de auth.users (security definer); nadie la borra
-- desde la API. El UPDATE se limita a columnas de perfil.
revoke insert, update, delete on agents from anon, authenticated;
grant update (full_name, phone, timezone, locale) on agents to authenticated;

-- ─── agent_monthly_usage: solo lectura para el asesor ────────────────────────

drop policy if exists "agent_own_monthly_usage" on agent_monthly_usage;

create policy "agent_monthly_usage: read own"
  on agent_monthly_usage for select to authenticated
  using (agent_id = auth.uid());

revoke insert, update, delete on agent_monthly_usage from anon, authenticated;

-- ─── tokens_usage: el backend inserta con el JWT del asesor; nada más ───────

drop policy if exists "agent_own_tokens_usage" on tokens_usage;

create policy "tokens_usage: read own"
  on tokens_usage for select to authenticated
  using (agent_id = auth.uid());

create policy "tokens_usage: insert own"
  on tokens_usage for insert to authenticated
  with check (agent_id = auth.uid());

revoke update, delete on tokens_usage from anon, authenticated;

-- ─── reminder_notifications: la escribe el cron (service_role) ──────────────

drop policy if exists "reminder_notifications: own records" on reminder_notifications;

create policy "reminder_notifications: read own"
  on reminder_notifications for select to authenticated
  using (agent_id = auth.uid());

revoke insert, update, delete on reminder_notifications from anon, authenticated;

-- ─── Registro de cobros de cuota ─────────────────────────────────────────────

create table usage_charges (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  field       text not null check (field in ('chat', 'ingestion')),
  year_month  date not null,
  created_at  timestamptz not null default now(),
  refunded_at timestamptz
);

create index idx_usage_charges_agent_created on usage_charges (agent_id, created_at desc);

alter table usage_charges enable row level security;

create policy "usage_charges: read own"
  on usage_charges for select to authenticated
  using (agent_id = auth.uid());

revoke all on usage_charges from anon, authenticated;
grant select on usage_charges to authenticated;
grant select, insert, update, delete on usage_charges to service_role;

-- ─── Verificación de quién llama ─────────────────────────────────────────────

-- Las funciones de cobro son security definer (escriben tablas que el asesor
-- ya no puede escribir), así que la RLS no las protege: cada una verifica
-- aquí que actúa sobre la cuenta del JWT. service_role (cron, webhooks) pasa.
create or replace function assert_usage_caller(p_agent_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  if p_agent_id is null or p_agent_id is distinct from auth.uid() then
    raise exception 'access_denied' using errcode = '42501';
  end if;
end;
$$;

-- ─── increment_monthly_usage: misma firma, ahora verifica y registra el cobro ─

create or replace function increment_monthly_usage(
  p_agent_id uuid,
  p_field    text
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_year_month      date := date_trunc('month', now())::date;
  v_chat_count      int;
  v_ingestion_count int;
  v_current         int;
  v_limit           int;
  v_charge_id       uuid;
begin
  perform assert_usage_caller(p_agent_id);

  if p_field not in ('chat', 'ingestion') then
    raise exception 'invalid_usage_field';
  end if;

  select
    case when p_field = 'chat'
      then (sp.limits->>'chat_messages_monthly')::int
      else (sp.limits->>'ingestions_monthly')::int
    end
  into v_limit
  from agents a
  join subscription_plans sp on sp.id = a.plan_id
  where a.id = p_agent_id;

  if v_limit is null then
    raise exception 'plan_not_found';
  end if;

  insert into agent_monthly_usage (agent_id, year_month, chat_count, ingestion_count)
  values (p_agent_id, v_year_month, 0, 0)
  on conflict (agent_id, year_month) do nothing;

  select chat_count, ingestion_count
    into v_chat_count, v_ingestion_count
    from agent_monthly_usage
   where agent_id   = p_agent_id
     and year_month = v_year_month
     for update;

  v_current := case when p_field = 'chat' then v_chat_count else v_ingestion_count end;

  if v_current >= v_limit then
    raise exception 'quota_exceeded'
      using detail = format('field=%s current=%s limit=%s', p_field, v_current, v_limit);
  end if;

  update agent_monthly_usage set
    chat_count      = chat_count      + case when p_field = 'chat'      then 1 else 0 end,
    ingestion_count = ingestion_count + case when p_field = 'ingestion' then 1 else 0 end,
    updated_at      = now()
  where agent_id   = p_agent_id
    and year_month = v_year_month;

  insert into usage_charges (agent_id, field, year_month)
  values (p_agent_id, p_field, v_year_month)
  returning id into v_charge_id;

  return jsonb_build_object(
    'charge_id',       v_charge_id,
    'chat_count',      v_chat_count      + case when p_field = 'chat'      then 1 else 0 end,
    'ingestion_count', v_ingestion_count + case when p_field = 'ingestion' then 1 else 0 end
  );
end;
$$;

-- ─── Devolución: solo de un cobro concreto, una vez, propio y reciente ──────

-- Reemplaza a decrement_monthly_usage(agent, field), que permitía bajar el
-- contador a voluntad. El código desplegado antes de esta migración llama a la
-- función vieja e ignora el error, así que mientras se despliega la función
-- nueva solo se pierde la devolución, nunca se cobra de más.
drop function if exists decrement_monthly_usage(uuid, text);

create or replace function refund_usage_charge(p_charge_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_charge usage_charges;
begin
  update usage_charges
     set refunded_at = now()
   where id = p_charge_id
     and refunded_at is null
     and created_at > now() - interval '15 minutes'
     and (agent_id = auth.uid() or coalesce(auth.role(), '') = 'service_role')
  returning * into v_charge;

  if not found then
    return false;
  end if;

  update agent_monthly_usage set
    chat_count      = greatest(chat_count      - case when v_charge.field = 'chat'      then 1 else 0 end, 0),
    ingestion_count = greatest(ingestion_count - case when v_charge.field = 'ingestion' then 1 else 0 end, 0),
    updated_at      = now()
  where agent_id   = v_charge.agent_id
    and year_month = v_charge.year_month;

  return true;
end;
$$;

-- ─── apply_promo_code: verifica al llamante y es de un solo uso ─────────────

create or replace function apply_promo_code(
  p_agent_id uuid,
  p_code     text
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_promo      record;
  v_agent      record;
  v_trial_ends timestamptz;
begin
  perform assert_usage_caller(p_agent_id);

  -- Lock de la fila del asesor: dos aplicaciones simultáneas no pasan ambas.
  select subscription_status, promo_code_used
    into v_agent
    from agents
   where id = p_agent_id
     for update;

  if not found then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_agent.promo_code_used is not null then
    raise exception 'promo_already_used';
  end if;

  if v_agent.subscription_status = 'active' then
    raise exception 'promo_not_applicable';
  end if;

  select id, trial_days, expires_at, max_uses, used_count
    into v_promo
    from promo_codes
   where code      = upper(p_code)
     and is_active = true
     for update;

  if not found then
    raise exception 'promo_not_found';
  end if;

  if v_promo.expires_at is not null and v_promo.expires_at < now() then
    raise exception 'promo_expired';
  end if;

  if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then
    raise exception 'promo_max_uses_reached';
  end if;

  v_trial_ends := now() + (v_promo.trial_days || ' days')::interval;

  update agents set
    trial_ends_at       = v_trial_ends,
    subscription_status = 'trial',
    promo_code_used     = upper(p_code)
  where id = p_agent_id;

  update promo_codes set
    used_count = used_count + 1
  where id = v_promo.id;

  return jsonb_build_object('trial_ends_at', v_trial_ends);
end;
$$;

-- ─── Permisos de ejecución ───────────────────────────────────────────────────

-- Supabase concede EXECUTE a anon/authenticated por default: hay que quitarlo
-- explícitamente, no basta con PUBLIC.
revoke execute on function assert_usage_caller(uuid)              from public, anon, authenticated;
revoke execute on function increment_monthly_usage(uuid, text)    from public, anon;
revoke execute on function refund_usage_charge(uuid)              from public, anon;
revoke execute on function apply_promo_code(uuid, text)           from public, anon;

grant execute on function increment_monthly_usage(uuid, text) to authenticated, service_role;
grant execute on function refund_usage_charge(uuid)           to authenticated, service_role;
grant execute on function apply_promo_code(uuid, text)        to authenticated, service_role;
