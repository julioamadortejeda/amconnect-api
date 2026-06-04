-- ─── Auto-registro de agente al crear usuario en auth ────────────────────────
-- Cuando Supabase Auth crea un usuario, se inserta automáticamente su perfil
-- en public.agents usando los metadatos enviados en el signup.

create or replace function tgfn_create_agent_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.agents (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, '')
  );
  return new;
end;
$$;

create trigger tg_auth_users_after_insert
  after insert on auth.users
  for each row execute function tgfn_create_agent_profile();
