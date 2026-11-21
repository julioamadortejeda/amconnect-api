-- Límite de peticiones por minuto por asesor (D-027).
--
-- Los NÚMEROS (60 general, 20 asistente, ventana de 60 s) NO viven aquí: viven en
-- supabase/functions/amconnect-api/shared/security.config.ts y la Edge Function
-- los manda en cada llamada. Esta migración solo pone el contador.
--
-- Por qué en Postgres y no en memoria: cada isolate de la Edge Function tiene su
-- propia memoria y Supabase levanta varios a la vez; un contador en memoria deja
-- pasar N veces el límite. La BD es lo único que todos los isolates comparten.
--
-- Algoritmo: ventana deslizante aproximada (sliding window counter). Se guarda
-- un contador por ventana fija y la estimación pondera la ventana anterior por
-- lo que aún "se traslapa" con el último minuto:
--     estimado = anterior * (1 - transcurrido/ventana) + actual
-- Así no se cuelan 2x el límite pegados al cambio de minuto (lo que permite una
-- ventana fija pura) y sigue costando una sola llamada.

-- ─── Tabla ───────────────────────────────────────────────────────────────────

create table public.rate_limit_buckets (
  agent_id       uuid        not null references public.agents (id) on delete cascade,
  bucket         text        not null check (bucket in ('general', 'ai')),
  window_seconds int         not null check (window_seconds between 1 and 3600),
  window_start   timestamptz not null,
  request_count  int         not null default 0 check (request_count >= 0),
  primary key (agent_id, bucket, window_seconds, window_start)
);

comment on table public.rate_limit_buckets is
  'Contadores del límite por minuto (D-027). Solo los escribe consume_rate_limit(); '
  'los límites viven en shared/security.config.ts de la Edge Function.';

-- Para el barrido de filas viejas.
create index rate_limit_buckets_window_start_idx on public.rate_limit_buckets (window_start);

-- Solo-servidor: el asesor NO puede leer ni escribir esta tabla con su JWT. Si
-- pudiera escribirla, se pondría el contador en 0 y el límite no serviría.
-- Todo el acceso pasa por consume_rate_limit() (security definer, abajo).
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

-- ─── consume_rate_limit: cuenta una petición y dice si pasa ─────────────────
--
-- Security definer porque la tabla no es escribible por el asesor (ver arriba).
-- El asesor sale SIEMPRE de auth.uid(): no hay parámetro de agente, así que A
-- no puede gastar ni reiniciar el contador de B. Lo único que el llamador elige
-- es el bucket ('general' | 'ai'), el límite y la ventana; llamarla directo por
-- el Data API con otros valores solo SUMA a sus propios contadores (nunca
-- resta), y una ventana distinta cae en otra fila, así que no puede "reiniciar"
-- la ventana que usa la Edge Function.
--
-- Atomicidad: la fila de la ventana actual se bloquea (FOR UPDATE) antes de leer
-- y escribir, así que dos peticiones simultáneas del mismo asesor se forman en
-- fila y la segunda ve el conteo de la primera.
--
-- Una petición rechazada NO se cuenta: si se contara, un cliente que reintenta
-- en bucle nunca saldría del bloqueo aunque respetara el Retry-After.
create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent    uuid := auth.uid();
  v_now      timestamptz := now();
  v_window   interval;
  v_start    timestamptz;
  v_elapsed  numeric;
  v_current  int;
  v_previous int;
  v_estimate numeric;
  v_wait     numeric;
begin
  if v_agent is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_bucket is null or p_bucket not in ('general', 'ai') then
    raise exception 'invalid_rate_limit_bucket' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds not between 1 and 3600 then
    raise exception 'invalid_rate_limit_config' using errcode = '22023';
  end if;

  v_window  := make_interval(secs => p_window_seconds);
  v_start   := date_bin(v_window, v_now, timestamptz 'epoch');
  v_elapsed := extract(epoch from v_now - v_start);

  insert into rate_limit_buckets (agent_id, bucket, window_seconds, window_start, request_count)
  values (v_agent, p_bucket, p_window_seconds, v_start, 0)
  on conflict do nothing;

  select request_count into v_current
    from rate_limit_buckets
   where agent_id = v_agent and bucket = p_bucket
     and window_seconds = p_window_seconds and window_start = v_start
     for update;

  select coalesce(max(request_count), 0) into v_previous
    from rate_limit_buckets
   where agent_id = v_agent and bucket = p_bucket
     and window_seconds = p_window_seconds and window_start = v_start - v_window;

  v_estimate := v_previous * (1 - v_elapsed / p_window_seconds) + v_current;

  if v_estimate + 1 <= p_limit then
    update rate_limit_buckets
       set request_count = v_current + 1
     where agent_id = v_agent and bucket = p_bucket
       and window_seconds = p_window_seconds and window_start = v_start;

    return jsonb_build_object(
      'allowed', true,
      'remaining', greatest(floor(p_limit - v_estimate - 1), 0)::int,
      'retryAfterSeconds', 0
    );
  end if;

  -- Cuántos segundos hasta que la estimación deje entrar UNA petición más.
  if v_current + 1 > p_limit then
    -- La ventana actual ya está llena: hay que esperar a la siguiente, donde la
    -- actual pasa a ser la "anterior" y pesa cada vez menos.
    v_wait := (p_window_seconds - v_elapsed)
              + greatest(0, p_window_seconds * (1 - (p_limit - 1)::numeric / v_current));
  else
    -- Cabe en la ventana actual en cuanto la anterior pese lo suficiente menos.
    v_wait := p_window_seconds * (1 - (p_limit - v_current - 1)::numeric / v_previous) - v_elapsed;
  end if;

  return jsonb_build_object(
    'allowed', false,
    'remaining', 0,
    'retryAfterSeconds', least(greatest(ceil(v_wait), 1), 2 * p_window_seconds)::int
  );
end;
$$;

revoke execute on function public.consume_rate_limit(text, int, int) from public, anon;
grant execute on function public.consume_rate_limit(text, int, int) to authenticated, service_role;

-- ─── Barrido: borra ventanas que ya no cuentan para nada ────────────────────
--
-- Una ventana sirve mientras es la actual o la anterior; después es basura. El
-- barrido corre cada 10 min con pg_cron (como postgres), así que la tabla nunca
-- pasa de unas cuantas filas por asesor activo. No es security definer: solo lo
-- ejecuta el dueño (cron) y nadie del Data API.
create or replace function public.purge_rate_limit_buckets()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from rate_limit_buckets
   where window_start < now() - make_interval(secs => 2 * window_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_rate_limit_buckets() from public, anon, authenticated;
grant execute on function public.purge_rate_limit_buckets() to service_role;

do $$
begin
  perform cron.unschedule('purge-rate-limit-buckets');
exception
  when others then null; -- aún no existe
end;
$$;

select cron.schedule(
  'purge-rate-limit-buckets',
  '*/10 * * * *',
  'select public.purge_rate_limit_buckets();'
);
