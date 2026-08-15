-- El cron de notificaciones necesita la URL del proyecto y NOTIFICATION_SECRET,
-- pero en Supabase Cloud el rol postgres NO puede persistir parámetros custom
-- (ALTER DATABASE/ROLE ... SET app.settings.* → 42501 permission denied).
-- Solución: leer primero de Vault (mecanismo oficial en hosted) y caer a
-- current_setting() como antes (útil en local, donde postgres sí es superuser).
--
-- REQUISITO en producción (SQL Editor, una sola vez):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'supabase_url');
--   select vault.create_secret('<mismo valor que la env NOTIFICATION_SECRET>', 'notification_secret');

-- Helper: lee un secret de Vault; null si no existe o Vault no está disponible.
create or replace function get_vault_secret(p_name text)
returns text as $$
declare
  v_value text;
begin
  begin
    select decrypted_secret into v_value
    from vault.decrypted_secrets
    where name = p_name
    order by created_at desc
    limit 1;
  exception when others then
    v_value := null; -- Vault ausente o sin permisos: se resuelve por current_setting
  end;
  return nullif(v_value, '');
end;
$$ language plpgsql;

create or replace function get_supabase_url()
returns text as $$
begin
  return coalesce(
    get_vault_secret('supabase_url'),
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'http://host.docker.internal:54321' -- solo dev local (stack Docker)
  );
end;
$$ language plpgsql;

-- Sigue fail-closed: sin secret configurado, el cron truena ruidosamente
-- (visible en cron.job_run_details) en vez de mandar un token adivinable.
create or replace function get_notification_secret()
returns text as $$
declare
  v_secret text;
begin
  v_secret := coalesce(
    get_vault_secret('notification_secret'),
    nullif(current_setting('app.settings.notification_secret', true), '')
  );
  if v_secret is null then
    raise exception 'notification_secret is not configured. Run: select vault.create_secret(''<secret>'', ''notification_secret'');';
  end if;
  return v_secret;
end;
$$ language plpgsql;
