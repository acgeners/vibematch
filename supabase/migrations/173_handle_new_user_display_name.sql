-- ============================================================
-- 173 — re-aplica handle_new_user na forma FINAL da 137 (display_name)
-- ============================================================
-- Achado no E2E do /bem-vindo (2026-07-31): o banco (nuvem E local) roda uma versão
-- ANTERIOR de `handle_new_user`, sem a captura de `display_name`/`avatar_url` — a 137
-- do repositório tem, mas a função viva não (drift de migration aplicada à mão; as
-- migrations têm colisões e nunca rodaram do zero, ver CLAUDE.md). Efeito: TODO
-- cadastro novo nascia sem nome — o onboarding não saúda, o chip da conta cai no
-- fallback. Este arquivo re-emite a função da 137, verbatim, e garante o trigger.
-- Idempotente (create or replace + drop if exists).
-- ============================================================

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
