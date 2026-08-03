-- ============================================================
-- 176 — ai_eval_read_acks.user_id ("marcar como lido" vira per-usuário)
-- ============================================================
-- "Lido" é um julgamento PESSOAL: significa "eu já olhei esta pendência e decidi
-- não agir agora". A tabela nasceu na 125 sem dono, quando o app era single-user.
--
-- Medido em 2026-08-03, com uma conta de Leitor: as abas dela liam `0 / 0 / 1`, ela
-- clicou UMA vez em "Marcar tudo como lido" e gravou **1907 linhas globais**
-- (943 veredito + 963 interesse + 1 untracked) sobre obras que nunca viu listadas.
-- E `unmarkAllAiEvalRead` apagava por fila para TODO MUNDO.
--
-- ⚠️ O número CRESCEU depois que a previsão de Interesse passou a ser escopada
-- (PR #301): 1846 → 1907. Não é coincidência e é o argumento central desta
-- migration — quanto mais correto fica o escopo das LEITURAS, maior o backlog
-- legítimo de cada usuário, e maior o despejo numa tabela de acks compartilhada.
-- As duas filas (`getAlignmentQueueWorks`, `getSynopsisQueueWorks`) já são
-- per-usuário; o ack era a única peça sem dono no caminho.
--
-- Backfill: todo ack pré-existente é do DONO (singleton mais antigo de
-- user_settings) — mesmo critério das migrations 138, 169, 170 e 175.
--
-- ⚠️ A CHAVE PRIMÁRIA muda: (work_id, queue) → (user_id, work_id, queue). Sem isso,
-- duas pessoas não podem marcar a MESMA obra na MESMA fila — a segunda sobrescreve
-- a primeira em vez de ter o próprio ack. O `onConflict` do upsert em
-- `server/actions/ai-eval-read.ts` acompanha esta chave; mexer numa sem a outra
-- troca "ack de cada um" por "último que clicou vence", em silêncio.
-- ============================================================

set lock_timeout = '5s';

alter table public.ai_eval_read_acks add column if not exists user_id uuid;

update public.ai_eval_read_acks
   set user_id = (
     select current_user_id from public.user_settings
      order by created_at asc limit 1
   )
 where user_id is null;

alter table public.ai_eval_read_acks alter column user_id set not null;

-- A troca da PK é segura sobre os dados existentes: com todos os acks atribuídos ao
-- mesmo dono, (user_id, work_id, queue) é único sempre que (work_id, queue) era.
alter table public.ai_eval_read_acks drop constraint if exists ai_eval_read_acks_pkey;
alter table public.ai_eval_read_acks
  add constraint ai_eval_read_acks_pkey primary key (user_id, work_id, queue);

-- A leitura real é sempre "os acks DESTA pessoa" (a fila vem depois). O índice antigo
-- só por `queue` não serve mais a esse predicado; fica, é barato.
create index if not exists ai_eval_read_acks_user_queue_idx
  on public.ai_eval_read_acks (user_id, queue);

-- GRANT + políticas (padrão da 142). As escritas do app seguem na service role com
-- user_id explícito; as políticas formalizam o dono.
grant select, insert, update, delete on public.ai_eval_read_acks to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'ai_eval_read_acks'
                    and policyname = 'ai_eval_read_acks_own_select') then
    create policy ai_eval_read_acks_own_select on public.ai_eval_read_acks
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'ai_eval_read_acks'
                    and policyname = 'ai_eval_read_acks_own_insert') then
    create policy ai_eval_read_acks_own_insert on public.ai_eval_read_acks
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'ai_eval_read_acks'
                    and policyname = 'ai_eval_read_acks_own_update') then
    create policy ai_eval_read_acks_own_update on public.ai_eval_read_acks
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'ai_eval_read_acks'
                    and policyname = 'ai_eval_read_acks_own_delete') then
    create policy ai_eval_read_acks_own_delete on public.ai_eval_read_acks
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on column public.ai_eval_read_acks.user_id is
  'Quem marcou como lido (= auth.uid()). Backfill da 176: acks pré-existentes são do dono do catálogo.';
