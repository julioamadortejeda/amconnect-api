-- Consentimiento del aviso de privacidad (LFPDPPP).
--
-- Guarda QUÉ versión del aviso aceptó cada asesor y CUÁNDO. Las dos columnas no
-- se pueden escribir por el Data API (el grant de UPDATE sobre `agents` sigue
-- limitado a full_name, phone, timezone y locale): un asesor no puede
-- declararse "aceptado" con una versión inventada ni fabricar la fecha. La
-- única vía de escritura es accept_privacy_policy(), que fija la fila del
-- propio JWT y pone la hora en el servidor.

alter table agents
  add column if not exists privacy_accepted_version text,
  add column if not exists privacy_accepted_at timestamptz;

create or replace function public.accept_privacy_policy(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
begin
  if v_agent is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_version is null or btrim(p_version) = '' then
    raise exception 'La versión del aviso es obligatoria' using errcode = '22023';
  end if;

  update public.agents
     set privacy_accepted_version = btrim(p_version),
         privacy_accepted_at = now()
   where id = v_agent;
end;
$$;

revoke execute on function public.accept_privacy_policy(text) from public, anon;
grant execute on function public.accept_privacy_policy(text) to authenticated;
