-- Aplica un código promocional de forma atómica:
-- valida expiración y límite de usos con SELECT FOR UPDATE,
-- actualiza el agente y el contador del promo en la misma transacción.
-- Lanza excepciones específicas que TypeScript identifica por mensaje.

create or replace function apply_promo_code(
  p_agent_id uuid,
  p_code     text
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_promo      record;
  v_trial_ends timestamptz;
begin
  -- Lockear la fila del promo para evitar uso concurrente
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