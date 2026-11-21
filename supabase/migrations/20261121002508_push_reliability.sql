-- Push y job nocturno confiables (auditoría 2026-11-20, top 10 #3, #4 y #5).
--
-- Tres problemas que el asesor sufría sin ver ningún error:
--
--   1. Push: el cron marcaba "notificado" aunque FCM fallara o no hubiera
--      dispositivos, y dos corridas que se traslapaban leían las mismas filas
--      (doble push). Ahora el cron RECLAMA filas de forma atómica y el estado de
--      la entrega vive aparte, en `reminder_push_deliveries`.
--   2. Tokens: el mismo dispositivo podía quedar registrado para dos asesores
--      (la RLS no dejaba limpiar el del dueño anterior), y el push de uno le
--      llegaba al otro, con nombres de clientes en el título.
--   3. Job nocturno: sin índice único, una falla transitoria creaba duplicados,
--      y un recordatorio generado que el asesor borraba volvía esa misma noche.
--
-- Re-ejecutable: todo es `if not exists` / `create or replace` / `drop ... if exists`.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tokens de dispositivo: un token, un dueño
-- ═══════════════════════════════════════════════════════════════════════════

-- Limpia los duplicados que ya existen: se queda el registro más reciente de
-- cada token (el último asesor que inició sesión en ese dispositivo). Los tokens
-- no llevan soft delete: un token muerto no es historia del asesor, es basura.
delete from agent_device_tokens t
 using (
   select id,
          row_number() over (partition by token order by updated_at desc, created_at desc, id) as rn
     from agent_device_tokens
 ) ranked
 where ranked.id = t.id
   and ranked.rn > 1;

create unique index if not exists agent_device_tokens_token_key
  on agent_device_tokens (token);

-- La restricción vieja (agent_id, token) queda redundante, pero se conserva a
-- propósito: la función desplegada hoy hace upsert con onConflict
-- "agent_id,token" y sin esa restricción fallaría entre esta migración y el
-- deploy. Se puede borrar en una migración posterior.

-- Reasigna el token al asesor que llama. SECURITY DEFINER porque tiene que poder
-- quitarle la fila al dueño anterior, que la RLS no le deja ver. Por eso no
-- recibe el agent_id: el dueño nuevo es SIEMPRE auth.uid(), nadie puede
-- registrar un token a nombre de otro.
create or replace function claim_device_token(p_token text, p_platform text)
returns agent_device_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid := auth.uid();
  v_row agent_device_tokens;
begin
  if v_agent_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_device_token' using errcode = '22023';
  end if;

  insert into agent_device_tokens (agent_id, token, platform)
  values (v_agent_id, p_token, p_platform)
  on conflict (token) do update
     set agent_id   = excluded.agent_id,
         platform   = excluded.platform,
         updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function claim_device_token(text, text) from public, anon;
grant execute on function claim_device_token(text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Push de recordatorios vencidos: reclamo atómico y estado de entrega
-- ═══════════════════════════════════════════════════════════════════════════

-- Estado de la entrega del push, una fila por recordatorio. Vive fuera de
-- `reminders` para no ensuciar el API (el listado usa `select *`) ni disparar
-- un evento de Realtime en la app cada vez que el cron reclama una fila.
--
-- `due_date` es la fecha del aviso al momento del reclamo: si el asesor
-- reagenda, ya no coincide con la del recordatorio y la entrega empieza de
-- cero (intentos en 1) sin necesidad de un trigger.
create table if not exists reminder_push_deliveries (
  reminder_id uuid primary key references reminders(id) on delete cascade,
  due_date    timestamptz not null,
  attempts    int not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  gave_up_at  timestamptz,
  last_error  text,
  updated_at  timestamptz not null default now()
);

comment on table reminder_push_deliveries is
  'Estado de la entrega del push de cada recordatorio vencido. Solo lo escribe el cron (service role).';

-- Solo servidor: RLS activo y sin policies, así el asesor no la ve ni la toca.
alter table reminder_push_deliveries enable row level security;
revoke all on reminder_push_deliveries from anon, authenticated;
grant select, insert, update, delete on reminder_push_deliveries to service_role;

-- La consulta del cron de cada minuto.
create index if not exists idx_reminders_due_unnotified
  on reminders (due_date)
  where is_active and notified_at is null;

-- Reclama hasta p_limit recordatorios vencidos y sin notificar, y los marca como
-- tomados por esta corrida. Dos corridas simultáneas nunca reciben la misma fila:
--   * `for update ... skip locked` hace que una corrida salte lo que la otra
--     está reclamando en ese instante;
--   * el `where` del `on conflict do update` vuelve a evaluar contra la fila
--     YA confirmada, así que si otra corrida reclamó (o envió) entre el snapshot
--     y el insert, la fila no se actualiza y no se devuelve.
-- Un reclamo vence a los p_lease_seconds: si la función muere a medio envío, o
-- FCM falló de forma transitoria, la fila se vuelve a tomar después (ese es el
-- reintento, con el lease como espera). Tras p_max_attempts deja de intentarse.
create or replace function claim_due_reminders(
  p_limit         int default 100,
  p_lease_seconds int default 300,
  p_max_attempts  int default 6
)
returns table (
  id          uuid,
  agent_id    uuid,
  title       text,
  description text,
  due_date    timestamptz,
  attempts    int
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lease interval := make_interval(secs => p_lease_seconds);
begin
  return query
  with due as (
    select r.id, r.due_date
      from reminders r
      join reminder_statuses s on s.id = r.status_id
      left join reminder_push_deliveries d
             on d.reminder_id = r.id
            and d.due_date = r.due_date
     where r.is_active
       and r.notified_at is null
       and r.due_date <= now()
       and s.code in ('CREATED', 'IN_PROGRESS')
       and (
             d.reminder_id is null
          or (d.sent_at is null
              and d.gave_up_at is null
              and d.attempts < p_max_attempts
              and (d.claimed_at is null or d.claimed_at < now() - v_lease))
           )
     order by r.due_date
     limit greatest(p_limit, 0)
       for update of r skip locked
  ),
  claimed as (
    insert into reminder_push_deliveries as pd (reminder_id, due_date, attempts, claimed_at, updated_at)
    select due.id, due.due_date, 1, now(), now()
      from due
    on conflict (reminder_id) do update
       set attempts   = case when pd.due_date = excluded.due_date then pd.attempts + 1 else 1 end,
           sent_at    = case when pd.due_date = excluded.due_date then pd.sent_at end,
           gave_up_at = case when pd.due_date = excluded.due_date then pd.gave_up_at end,
           last_error = case when pd.due_date = excluded.due_date then pd.last_error end,
           due_date   = excluded.due_date,
           claimed_at = now(),
           updated_at = now()
     where pd.due_date is distinct from excluded.due_date
        or (pd.sent_at is null
            and pd.gave_up_at is null
            and pd.attempts < p_max_attempts
            and (pd.claimed_at is null or pd.claimed_at < now() - v_lease))
    returning pd.reminder_id, pd.attempts
  )
  select r.id, r.agent_id, r.title, r.description, r.due_date, c.attempts
    from claimed c
    join reminders r on r.id = c.reminder_id
   order by r.due_date;
end;
$$;

-- Solo el cron (service role). Security invoker: no salta nada que el service
-- role no salte ya, y el asesor ni siquiera puede ejecutarla.
revoke execute on function claim_due_reminders(int, int, int) from public, anon, authenticated;
grant execute on function claim_due_reminders(int, int, int) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Job nocturno idempotente
-- ═══════════════════════════════════════════════════════════════════════════

-- Antes de crear el índice único hay que resolver los duplicados que ya
-- existen. Se conserva uno por ocurrencia: primero el activo, luego el que el
-- asesor ya trabajó (estado distinto de CREATED), luego el más viejo. A los
-- demás se les quita la ocurrencia (dejan de contar para el job) y, si eran
-- copias intactas (activas y en CREATED), se borran con soft delete.
with ranked as (
  select r.id,
         r.is_active,
         s.code as status_code,
         row_number() over (
           partition by r.agent_id, r.type_id, coalesce(r.policy_id, r.contact_id), r.occurrence_date
           order by r.is_active desc, (s.code <> 'CREATED') desc, r.created_at, r.id
         ) as rn
    from reminders r
    join reminder_statuses s on s.id = r.status_id
   where r.occurrence_date is not null
)
update reminders r
   set occurrence_date = null,
       is_active  = case when ranked.is_active and ranked.status_code = 'CREATED' then false else r.is_active end,
       deleted_at = case when ranked.is_active and ranked.status_code = 'CREATED' then now() else r.deleted_at end
  from ranked
 where ranked.id = r.id
   and ranked.rn > 1;

-- Una ocurrencia, un recordatorio, en CUALQUIER estado — incluido el borrado.
-- Que el índice cuente las filas con soft delete es lo que hace que el job no
-- regenere un recordatorio que el asesor borró: la ocurrencia ya está tomada.
-- La siguiente ocurrencia tiene otra fecha y se genera normal.
create unique index if not exists idx_reminders_occurrence_unique
  on reminders (agent_id, type_id, coalesce(policy_id, contact_id), occurrence_date)
  where occurrence_date is not null;

-- El índice viejo (no único) queda cubierto por el nuevo.
drop index if exists idx_reminders_occurrence;

-- Inserta los recordatorios generados y devuelve, por cada uno, si se creó o si
-- su ocurrencia ya existía. Es RPC y no un insert desde TypeScript porque el
-- `on conflict` tiene que apuntar a un índice parcial con expresión, y el Data
-- API no sabe inferir ese destino. Security invoker: con el JWT del asesor la
-- RLS de `reminders` aplica igual que en un insert directo.
create or replace function insert_generated_reminders(p_rows jsonb)
returns table (
  id              uuid,
  type_id         uuid,
  occurrence_date date,
  title           text,
  due_date        timestamptz,
  is_active       boolean,
  is_new          boolean
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with input as (
    select *
      from jsonb_to_recordset(p_rows) as x(
        agent_id uuid, policy_id uuid, contact_id uuid, type_id uuid,
        title text, description text, due_date timestamptz,
        occurrence_date date, status_id uuid
      )
  ),
  ins as (
    insert into reminders as r (
      agent_id, policy_id, contact_id, type_id, title, description,
      due_date, occurrence_date, status_id
    )
    select i.agent_id, i.policy_id, i.contact_id, i.type_id, i.title, i.description,
           i.due_date, i.occurrence_date, i.status_id
      from input i
    on conflict (agent_id, type_id, (coalesce(policy_id, contact_id)), occurrence_date)
       where occurrence_date is not null
       do nothing
    returning r.id, r.type_id, r.occurrence_date, r.title, r.due_date
  )
  select ins.id, ins.type_id, ins.occurrence_date, ins.title, ins.due_date, true, true
    from ins
  union all
  -- Las que ya existían (el snapshot del statement no ve las recién insertadas).
  select r.id, r.type_id, r.occurrence_date, r.title, r.due_date, r.is_active, false
    from input i
    join reminders r
      on r.agent_id = i.agent_id
     and r.type_id = i.type_id
     and coalesce(r.policy_id, r.contact_id) = coalesce(i.policy_id, i.contact_id)
     and r.occurrence_date = i.occurrence_date
   where not exists (
     select 1 from ins
      where ins.type_id = i.type_id
        and ins.occurrence_date = i.occurrence_date
   );
end;
$$;

revoke execute on function insert_generated_reminders(jsonb) from public, anon;
grant execute on function insert_generated_reminders(jsonb) to authenticated, service_role;
