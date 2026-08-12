-- Cron diario que genera los recordatorios de pólizas y cumpleaños.
--
-- Los recordatorios NO se materializan por adelantado: este job recorre cada
-- noche las pólizas, recalcula la siguiente ocurrencia desde la regla de cada
-- una (fecha ancla + frecuencia de pago) y crea el recordatorio solo cuando esa
-- fecha entra en la ventana de aviso configurada en reminder_settings.
--
-- La URL y el secreto salen de Vault (get_supabase_url / get_notification_secret),
-- nunca hardcodeados — mismo patrón que cron_check_due_reminders.

create or replace function cron_generate_due_reminders()
returns void as $$
declare
  v_url text;
  v_secret text;
begin
  v_url := get_supabase_url() || '/functions/v1/amconnect-api/reminders/generate-due';
  v_secret := get_notification_secret();

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$ language plpgsql;

-- pg_cron programa en UTC. México dejó el horario de verano en 2022, así que
-- CST es UTC-6 todo el año: 07:00 UTC = 1:00 AM hora del asesor.
do $$
begin
  perform cron.unschedule('generate-due-reminders');
exception
  when others then null; -- aún no existe
end;
$$;

select cron.schedule(
  'generate-due-reminders',
  '0 7 * * *',
  'select cron_generate_due_reminders();'
);
