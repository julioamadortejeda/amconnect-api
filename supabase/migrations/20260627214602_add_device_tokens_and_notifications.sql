-- ─── Refactorización de Triggers al Estándar tgfn_ y Configuración de Notificaciones ───

-- 1. Crear la nueva función de trigger con el estándar tgfn_
create or replace function tgfn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Migrar los triggers existentes al nuevo estándar tgfn_set_updated_at
drop trigger if exists trg_contacts_updated_at on contacts;
create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function tgfn_set_updated_at();

drop trigger if exists trg_policies_updated_at on policies;
create trigger trg_policies_updated_at
  before update on policies
  for each row execute function tgfn_set_updated_at();

drop trigger if exists trg_reminders_updated_at on reminders;
create trigger trg_reminders_updated_at
  before update on reminders
  for each row execute function tgfn_set_updated_at();

drop trigger if exists trg_agents_updated_at on agents;
create trigger trg_agents_updated_at
  before update on agents
  for each row execute function tgfn_set_updated_at();

drop trigger if exists trg_ai_sessions_updated_at on ai_sessions;
create trigger trg_ai_sessions_updated_at
  before update on ai_sessions
  for each row execute function tgfn_set_updated_at();

drop trigger if exists trg_ai_pending_tasks_updated_at on ai_pending_tasks;
create trigger trg_ai_pending_tasks_updated_at
  before update on ai_pending_tasks
  for each row execute function tgfn_set_updated_at();

-- 3. Eliminar la función obsoleta set_updated_at
drop function if exists set_updated_at();

-- 4. Crear tabla de tokens de dispositivo
create table agent_device_tokens (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references agents(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id, token)
);

-- Habilitar RLS
alter table agent_device_tokens enable row level security;

create policy "device_tokens: own records"
  on agent_device_tokens for all
  using (auth.uid() = agent_id);

-- Trigger para updated_at en agent_device_tokens usando la nueva función estándar
create trigger trg_agent_device_tokens_updated_at
  before update on agent_device_tokens
  for each row
  execute function tgfn_set_updated_at();

-- 5. Actualizar los límites de los planes de suscripción para incluir max_devices
update subscription_plans 
set limits = limits || '{"max_devices": 1}'::jsonb 
where slug = 'nuevo';

update subscription_plans 
set limits = limits || '{"max_devices": 2}'::jsonb 
where slug = 'consolidado';

update subscription_plans 
set limits = limits || '{"max_devices": 5}'::jsonb 
where slug = 'top';

-- 6. Funciones auxiliares para obtener la configuración de URL y Secreto de Notificaciones
create or replace function get_supabase_url()
returns text as $$
begin
  return coalesce(
    current_setting('app.settings.supabase_url', true),
    'http://host.docker.internal:54321'
  );
end;
$$ language plpgsql;

create or replace function get_notification_secret()
returns text as $$
begin
  return coalesce(
    current_setting('app.settings.notification_secret', true),
    'super-secret-notification-token'
  );
end;
$$ language plpgsql;

-- 7. Habilitar extensiones necesarias
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 8. Programar el cron para verificar recordatorios vencidos cada minuto
create or replace function cron_check_due_reminders()
returns void as $$
declare
  v_url text;
  v_secret text;
begin
  v_url := get_supabase_url() || '/functions/v1/amconnect-api/notifications/send-due';
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

-- Programar cron
select cron.schedule(
  'send-due-reminders',
  '* * * * *', -- Cada minuto
  'select cron_check_due_reminders();'
);
