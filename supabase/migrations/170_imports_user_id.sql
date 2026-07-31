-- ============================================================
-- 170 — imports.user_id (import multi-user, Bloco 02 do destrave)
-- ============================================================
-- A tabela `imports` nasceu sem dono (001, era single-user). Com o import aberto a
-- qualquer usuário logado, cada importação precisa registrar QUEM importou:
--   - "Revisar pendentes" filtra por imports.user_id (cada um revisa o que importou);
--   - o Histórico do /import vira per-user;
--   - import_rows herda o escopo via join (import_id → imports).
--
-- Backfill: todo import pré-existente é do DONO (singleton mais antigo de
-- user_settings — mesmo critério das migrations 138 e 169).
-- ============================================================

set lock_timeout = '5s';

alter table public.imports add column if not exists user_id uuid;

update public.imports
   set user_id = (
     select current_user_id from public.user_settings
      order by created_at asc limit 1
   )
 where user_id is null;

alter table public.imports alter column user_id set not null;

create index if not exists imports_user_id_idx on public.imports (user_id);

-- GRANT + políticas (padrão da 142). As escritas do app seguem na service role com
-- user_id explícito; as políticas formalizam o dono e protegem qualquer uso futuro
-- do cliente de sessão. `import_rows` fica sem grant: escopo dela deriva do join.
grant select, insert, update, delete on public.imports to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'imports' and policyname = 'imports_own_select') then
    create policy imports_own_select on public.imports
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'imports' and policyname = 'imports_own_insert') then
    create policy imports_own_insert on public.imports
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'imports' and policyname = 'imports_own_update') then
    create policy imports_own_update on public.imports
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'imports' and policyname = 'imports_own_delete') then
    create policy imports_own_delete on public.imports
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on column public.imports.user_id is
  'Quem importou (= auth.uid()). Backfill da 170: imports pré-existentes são do dono do catálogo.';
