-- get_notification_secret() fail-closed: sin fallback hardcodeado.
-- Antes hacía coalesce(current_setting(...), 'super-secret-notification-token'),
-- lo que dejaba el endpoint de cron "protegido" por un token visible en el repo
-- si nadie configuraba el setting. Ahora, si el setting no existe, la función
-- lanza excepción y el cron falla ruidosamente (visible en cron.job_run_details)
-- en lugar de mandar un secret adivinable.
--
-- REQUISITO antes de aplicar: configurar el setting con el mismo valor que la
-- env var NOTIFICATION_SECRET de la Edge Function:
--   ALTER DATABASE postgres SET app.settings.notification_secret = '<valor>';

create or replace function get_notification_secret()
returns text as $$
declare
  v_secret text;
begin
  v_secret := current_setting('app.settings.notification_secret', true);
  if v_secret is null or v_secret = '' then
    raise exception 'app.settings.notification_secret is not configured. Run: ALTER DATABASE postgres SET app.settings.notification_secret = ''<secret>'';';
  end if;
  return v_secret;
end;
$$ language plpgsql;
