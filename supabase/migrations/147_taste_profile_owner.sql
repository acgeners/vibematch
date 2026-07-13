-- 147_taste_profile_owner.sql
-- FATIA 2b — o perfil de gosto ganha DONO.
--
-- 🔴 O buraco que esta migration fecha, antes que alguém caia nele:
--
-- `taste_profile` não tem `user_id`. A linha é encontrada por `is_current = true` — UMA no
-- banco inteiro. Se um Assinante gerar o perfil dele hoje, ele marca a dele como `is_current` e
-- desmarca a do DONO. No recalc seguinte, o Ridge do dono treinaria com as `loved_tags` de
-- OUTRA PESSOA, e as 878 Notas Previstas dele mudariam. Sem erro, sem log.
--
-- É o mesmo bug da Fatia 1 (dado pessoal em linha sem dono), num lugar novo — e este custa
-- caro duas vezes: o perfil é gerado por LLM (custa dinheiro) e alimenta o modelo (custa
-- confiança nos números).
--
-- ── O que o perfil é, e por que ele NÃO é privilégio de plano ─────────────────────────────
--
-- O perfil entra no recalc como BASE, e é mesclado com as tags que a pessoa DECLAROU à mão
-- (`user_tag_preferences`, que já tem dono e é de graça). Ou seja, ele tem dois níveis:
--
--   DECLARADO (grátis) → a pessoa marca "amo/evito" nas tags. É isto que faz o Alinhamento
--                        existir para um Leitor free.
--   INFERIDO (pago)    → a IA lê as notas dela e DESCOBRE o perfil sozinha (loved_tags,
--                        padrões narrativos, prosa). É LLM, e é o que se cobra.
--
-- A diferença entre os planos não é o número — é QUEM FAZ O TRABALHO.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/147_taste_profile_owner.sql

alter table public.taste_profile
  add column if not exists user_id uuid;

-- Backfill: todo perfil que existe hoje é do DONO (a tabela não tem dono, mas o dado tem).
update public.taste_profile
set user_id = (select current_user_id from public.user_settings order by created_at asc limit 1)
where user_id is null;

alter table public.taste_profile
  alter column user_id set not null;

-- `is_current` passa a valer POR USUÁRIO. Sem este índice, dois usuários com perfil corrente
-- continuariam disputando a mesma linha lógica — que é exatamente o bug.
create unique index if not exists uniq_taste_profile_current_per_user
  on public.taste_profile (user_id)
  where is_current = true;

create index if not exists idx_taste_profile_user on public.taste_profile (user_id);

-- ── RLS: cada um só lê e escreve o próprio perfil (mesmo padrão da mig 142).
-- A service role ignora RLS — é ela que o recalc usa, com o user_id EXPLÍCITO.
alter table public.taste_profile enable row level security;

grant select, insert, update, delete on public.taste_profile to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taste_profile' and policyname='taste_profile_own_select') then
    create policy taste_profile_own_select on public.taste_profile
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taste_profile' and policyname='taste_profile_own_insert') then
    create policy taste_profile_own_insert on public.taste_profile
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taste_profile' and policyname='taste_profile_own_update') then
    create policy taste_profile_own_update on public.taste_profile
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taste_profile' and policyname='taste_profile_own_delete') then
    create policy taste_profile_own_delete on public.taste_profile
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on column public.taste_profile.user_id is
  'DONO do perfil. Sem esta coluna, `is_current = true` era único no banco INTEIRO: um Assinante gerando o perfil dele desmarcava o do dono, e o Ridge do dono passava a treinar com as loved_tags de outra pessoa — sem erro e sem log. O índice único parcial (user_id) where is_current garante um perfil corrente POR PESSOA.';
