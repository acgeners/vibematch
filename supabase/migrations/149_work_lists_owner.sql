-- 149_work_lists_owner.sql
-- FATIA 2b — os grupos de favoritos ganham DONO.
--
-- `work_lists` não tem `user_id`. Consequência hoje: a Leitora abre /favoritos e vê OS GRUPOS
-- DELE ("Comfort reads", "Pra maratonar"…) — a curadoria pessoal de outra pessoa, apresentada
-- como se fosse a dela. É o mesmo bug das Fatias 1 e 2a, no último lugar onde ele restava.
--
-- E é o que trava a regra que você definiu: **o free pode criar os grupos DELE**. Sem dono na
-- tabela, "criar um grupo" significaria criar um grupo no espaço de todo mundo — por isso o
-- gate era `ensureAdmin`.
--
-- `work_list_items` NÃO precisa de dono: ele herda pelo `list_id` (a FK aponta pro grupo, que
-- agora tem dono). Duplicar o `user_id` ali seria criar uma segunda verdade — e duas verdades
-- sobre a mesma coisa é como nascem os bugs silenciosos deste projeto.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/149_work_lists_owner.sql

alter table public.work_lists
  add column if not exists user_id uuid;

-- Backfill: todo grupo que existe hoje é do DONO.
update public.work_lists
set user_id = (select current_user_id from public.user_settings order by created_at asc limit 1)
where user_id is null;

alter table public.work_lists
  alter column user_id set not null;

create index if not exists idx_work_lists_user on public.work_lists (user_id);

-- ── RLS: cada um só vê e só mexe nos próprios grupos.
alter table public.work_lists enable row level security;
alter table public.work_list_items enable row level security;

grant select, insert, update, delete on public.work_lists      to authenticated;
grant select, insert, update, delete on public.work_list_items to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_lists' and policyname='work_lists_own_select') then
    create policy work_lists_own_select on public.work_lists
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_lists' and policyname='work_lists_own_insert') then
    create policy work_lists_own_insert on public.work_lists
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_lists' and policyname='work_lists_own_update') then
    create policy work_lists_own_update on public.work_lists
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_lists' and policyname='work_lists_own_delete') then
    create policy work_lists_own_delete on public.work_lists
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;

  -- Itens: o dono é o do GRUPO. A política pergunta ao grupo — não guarda uma cópia do dono.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='work_list_items' and policyname='work_list_items_own_all') then
    create policy work_list_items_own_all on public.work_list_items
      for all to authenticated
      using (exists (
        select 1 from public.work_lists l
        where l.id = work_list_items.list_id and l.user_id = (select auth.uid())
      ))
      with check (exists (
        select 1 from public.work_lists l
        where l.id = work_list_items.list_id and l.user_id = (select auth.uid())
      ));
  end if;
end $$;

comment on column public.work_lists.user_id is
  'DONO do grupo (Fatia 2b). Sem ele, a Leitora abria /favoritos e via os grupos do Curador como se fossem dela — e "criar um grupo" seria criar no espaço de todo mundo, que é por que o gate era ensureAdmin. work_list_items herda o dono pelo list_id: duplicar o user_id lá criaria uma segunda verdade.';
