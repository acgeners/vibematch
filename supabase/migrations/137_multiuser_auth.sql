-- 137_multiuser_auth.sql
-- Fase 1b da fundação multi-user (PLANO-MULTIUSER.md).
--
-- ADITIVO por design: NÃO altera a linha singleton nem o comportamento
-- single-user atual (deslogado). Só prepara user_settings pra ganhar 1 linha
-- por usuário de auth e auto-provisiona cada novo signup com plano FREE.
--
-- Aplicar à mão no SQL editor do Supabase (CLI dessincronizado — ver
-- memória project_migration_apply_mechanism).

-- 1) Vincula uma linha de user_settings a um usuário do Supabase Auth.
--    NULL = linha singleton legada (dono, pré-auth) → fica fora do índice
--    único parcial abaixo, então continua intocada.
alter table public.user_settings
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

-- 2) No máximo uma linha de settings por usuário de auth.
create unique index if not exists user_settings_auth_user_id_key
  on public.user_settings (auth_user_id)
  where auth_user_id is not null;

-- 3) Provisiona uma linha de settings (plano FREE) a cada novo signup.
--    current_user_id = id do usuário de auth → getCurrentUserId (via sessão)
--    encontra a linha certa. Idempotente (guard NOT EXISTS). SECURITY DEFINER
--    pra o trigger poder inserir em public.user_settings a partir de auth.users.
--    display_name/avatar vêm do user_metadata: 'name' (signup por email) ou
--    'full_name'/'avatar_url' (Google OAuth).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.user_settings where auth_user_id = new.id) then
    insert into public.user_settings (current_user_id, auth_user_id, user_plan, email, display_name, avatar_url)
    values (
      new.id, new.id, 'free', new.email,
      coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
      new.raw_user_meta_data->>'avatar_url'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- NOTA (Fase 2): reivindicar a linha singleton + os dados per-user do DONO
-- (re-chavear do current_user_id legado pro uid de auth) é uma migração
-- deliberada futura. Aqui NÃO tocamos na singleton — o dono segue usando
-- deslogado sem nenhuma mudança.
