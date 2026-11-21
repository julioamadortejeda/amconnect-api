-- Evidencia del consentimiento del aviso de privacidad (LFPDPPP).
--
-- agents.privacy_accepted_* solo dice la ÚLTIMA versión aceptada. Ante una
-- queja o una autoridad hace falta PRUEBA de cada aceptación: cuándo, qué
-- versión, qué casillas, desde qué IP/dispositivo/app. Esta tabla es esa
-- bitácora. Es append-only: un re-aceptar inserta una fila nueva; nunca se
-- actualiza ni se borra (ni soft delete: es evidencia legal).

create table if not exists privacy_consents (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references agents(id),
  version            text not null,
  accepted_notice    boolean not null,
  accepted_sensitive boolean not null,
  ip                 inet,
  user_agent         text,
  app_version        text,
  platform           text check (platform in ('ios', 'android', 'web')),
  locale             text,
  accepted_at        timestamptz not null default now()
);

create index if not exists idx_privacy_consents_agent
  on privacy_consents (agent_id, accepted_at desc);

alter table privacy_consents enable row level security;

drop policy if exists "privacy_consents: select own" on privacy_consents;
create policy "privacy_consents: select own" on privacy_consents
  for select to authenticated
  using (agent_id = auth.uid());

-- Nadie escribe por el Data API: solo record_privacy_consent() (security definer).
revoke all on privacy_consents from public, anon, authenticated;
grant select on privacy_consents to authenticated;

-- Reemplaza accept_privacy_policy(text): se BORRA porque nada en producción la
-- usa todavía (la migración que la creó no se ha desplegado) y dejarla viva
-- sería una vía de escritura que no deja evidencia.
drop function if exists public.accept_privacy_policy(text);

-- LIMITACIÓN CONOCIDA: el JWT del asesor puede llamar esta función directo
-- (PostgREST /rpc) y mandar una IP/user-agent falsos para SU PROPIO
-- consentimiento. Es aceptable: solo debilita su propia evidencia. En el flujo
-- normal los valores los captura el servidor (Edge Function) de los headers
-- de la petición, no los declara el cliente.
create or replace function public.record_privacy_consent(
  p_version            text,
  p_accepted_notice    boolean,
  p_accepted_sensitive boolean,
  p_ip                 text,
  p_user_agent         text,
  p_app_version        text,
  p_platform           text,
  p_locale             text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
  v_version text := btrim(coalesce(p_version, ''));
  v_ip inet;
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_now timestamptz := now();
begin
  if v_agent is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if v_version = '' then
    raise exception 'La versión del aviso es obligatoria' using errcode = '22023';
  end if;

  if p_accepted_notice is distinct from true or p_accepted_sensitive is distinct from true then
    raise exception 'Se requieren ambas aceptaciones' using errcode = '22023';
  end if;

  -- Una IP mal formada nunca debe impedir el consentimiento: se guarda null.
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Valor fuera del check de plataforma → null, por el mismo motivo.
  if v_platform not in ('ios', 'android', 'web') then
    v_platform := null;
  end if;

  insert into public.privacy_consents (
    agent_id, version, accepted_notice, accepted_sensitive,
    ip, user_agent, app_version, platform, locale, accepted_at
  ) values (
    v_agent, v_version, true, true,
    v_ip, left(p_user_agent, 500), left(p_app_version, 50), v_platform, left(p_locale, 20), v_now
  );

  update public.agents
     set privacy_accepted_version = v_version,
         privacy_accepted_at = v_now
   where id = v_agent;
end;
$$;

revoke execute on function public.record_privacy_consent(text, boolean, boolean, text, text, text, text, text)
  from public, anon;
grant execute on function public.record_privacy_consent(text, boolean, boolean, text, text, text, text, text)
  to authenticated;
