-- ============================================================
-- 175 — recommendation_chats.user_id (a última tabela pessoal sem dono)
-- ============================================================
-- `recommendation_chats` guarda CONVERSAS — o que a pessoa pediu, o que a IA
-- respondeu e as recomendações de cada turno. É dado pessoal, e a tabela nasceu
-- sem NENHUMA coluna de dono. Consequência medida em 2026-08-03:
-- `listChatsAction` devolvia slug, título e nº de mensagens de TODAS as conversas
-- para qualquer chamador — e, sendo `"use server"`, ela também é um endpoint HTTP
-- público (ver PLANO-FREE-PAGO §7).
--
-- Não dava pra corrigir só no código: sem a coluna não existe por onde filtrar.
--
-- ⚠️ Esta tabela era INVISÍVEL à auditoria que achou os outros três vazamentos:
-- aquela varredura partiu de "tabelas que TÊM coluna de dono" e cruzou com quem
-- lia sem filtrar. Uma tabela com dado pessoal e sem coluna de dono não podia
-- aparecer ali. Fica o registro do limite do método.
--
-- Backfill: toda conversa pré-existente é do DONO (singleton mais antigo de
-- user_settings) — mesmo critério das migrations 138, 169 e 170.
--
-- ⚠️ NÃO tocar em `recommendation_chats_slug_key` (UNIQUE global em `slug`). O
-- gerador de slug (`generateChatSlug`) varre TODOS os slugs do dia justamente
-- porque a unicidade é global; escopá-lo por usuário faria duas pessoas
-- disputarem `2026-08-03-1` no mesmo dia e uma das duas tomaria erro de conflito.
-- ============================================================

set lock_timeout = '5s';

alter table public.recommendation_chats add column if not exists user_id uuid;

update public.recommendation_chats
   set user_id = (
     select current_user_id from public.user_settings
      order by created_at asc limit 1
   )
 where user_id is null;

alter table public.recommendation_chats alter column user_id set not null;

-- A listagem é sempre "minhas conversas, mais recentes primeiro" — o índice cobre
-- exatamente esse predicado. O `idx_recommendation_chats_updated` (só updated_at)
-- deixa de servir à consulta principal, mas fica: é barato e cobre varreduras
-- administrativas.
create index if not exists recommendation_chats_user_updated_idx
  on public.recommendation_chats (user_id, updated_at desc);

-- GRANT + políticas (padrão da 142). As escritas do app seguem na service role com
-- user_id explícito; as políticas formalizam o dono e protegem qualquer uso futuro
-- do cliente de sessão.
grant select, insert, update, delete on public.recommendation_chats to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'recommendation_chats'
                    and policyname = 'recommendation_chats_own_select') then
    create policy recommendation_chats_own_select on public.recommendation_chats
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'recommendation_chats'
                    and policyname = 'recommendation_chats_own_insert') then
    create policy recommendation_chats_own_insert on public.recommendation_chats
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'recommendation_chats'
                    and policyname = 'recommendation_chats_own_update') then
    create policy recommendation_chats_own_update on public.recommendation_chats
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'recommendation_chats'
                    and policyname = 'recommendation_chats_own_delete') then
    create policy recommendation_chats_own_delete on public.recommendation_chats
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on column public.recommendation_chats.user_id is
  'Dono da conversa (= auth.uid()). Backfill da 175: conversas pré-existentes são do dono do catálogo.';
