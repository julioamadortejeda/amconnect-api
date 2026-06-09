-- Reemplaza increment_monthly_usage con versión atómica que consulta el límite
-- directamente desde subscription_plans del agente — sin recibir el límite como parámetro.

drop function if exists increment_monthly_usage(uuid, text);

-- Consulta el límite del plan, verifica cuota, incrementa si hay espacio,
-- o lanza 'quota_exceeded'. Devuelve uso actualizado como jsonb.
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
begin
  -- Obtener límite del plan del agente
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

  -- Asegurar que existe la fila del mes actual
  insert into agent_monthly_usage (agent_id, year_month, chat_count, ingestion_count)
  values (p_agent_id, v_year_month, 0, 0)
  on conflict (agent_id, year_month) do nothing;

  -- Lockear la fila para la duración de esta transacción
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

  return jsonb_build_object(
    'chat_count',      v_chat_count      + case when p_field = 'chat'      then 1 else 0 end,
    'ingestion_count', v_ingestion_count + case when p_field = 'ingestion' then 1 else 0 end
  );
end;
$$;

-- Decrementa con piso en 0 (atómico). No lanza error si ya está en 0.
create or replace function decrement_monthly_usage(
  p_agent_id uuid,
  p_field    text
) returns void
language sql
security definer set search_path = public
as $$
  update agent_monthly_usage set
    chat_count      = greatest(chat_count      - case when p_field = 'chat'      then 1 else 0 end, 0),
    ingestion_count = greatest(ingestion_count - case when p_field = 'ingestion' then 1 else 0 end, 0),
    updated_at      = now()
  where agent_id   = p_agent_id
    and year_month = date_trunc('month', now())::date;
$$;