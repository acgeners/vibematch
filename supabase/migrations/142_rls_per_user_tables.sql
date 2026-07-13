-- 142_rls_per_user_tables.sql
--
-- RLS DE VERDADE nas tabelas per-usuário (PLANO-MULTIUSER-FASE2.md §6).
--
-- O problema: hoje TODO acesso usa a service role key, que **ignora RLS por definição**. A RLS
-- está ligada em tudo, mas sem política permissiva — o que só serve pra bloquear o cliente
-- anônimo (que o app não usa). Ou seja: o isolamento entre usuários depende inteiramente de o
-- código lembrar de escrever `.eq("user_id", …)` em cada query. Esquecer NÃO dá erro: devolve,
-- em silêncio, o dado de outra pessoa. É o mesmo padrão de falha do `select` que corta em 1000
-- linhas — erra e produz resultado.
--
-- E não é hipotético: o PR #127 fechou 7 actions em que um visitante SEM SESSÃO escrevia nas
-- linhas do dono. Aquilo foi corrigido no código. Isto aqui move a garantia para o BANCO: com o
-- cliente de sessão, é o Postgres que filtra por você, em vez de você lembrar de filtrar.
--
-- Escopo desta migration: só as tabelas com dono (`user_id` / `auth_user_id`). O catálogo
-- (works, category_scores, tags, reviews…) NÃO ganha política: ele é compartilhado por design e
-- segue sendo lido/escrito pela service role, que ignora RLS.
--
-- ⚠️ Isto NÃO muda nada sozinho. As políticas só entram em vigor no que usar o cliente
-- AUTENTICADO (sessão). O código que segue na service role (recalc em background, curadoria,
-- leituras do chrome) continua passando por cima delas — de propósito: o recalc roda SEM sessão
-- e precisa do biasMap do dono; com RLS ele veria zero linhas e recalcularia as notas do dono
-- sem a calibração dele, em silêncio.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- COMO APLICAR (leia — a 1ª tentativa deu DEADLOCK)
--
-- O SQL editor roda o script inteiro numa ÚNICA transação. `create/drop policy` e
-- `alter table … enable rls` pegam **AccessExclusiveLock**, e eles ficam segurados até o commit
-- — ou seja, as 9 tabelas travadas ao mesmo tempo. Se o app estiver lendo qualquer uma delas
-- (o dev server em :3001 lê `user_tag_preferences` e `attribute_bias` em toda página), o
-- Postgres detecta o abraço mortal e aborta:
--
--   ERROR: 40P01: deadlock detected
--
-- Duas defesas, nesta ordem:
--   1. **Pare o app** (ou espere-o ficar ocioso) antes de rodar. É o que resolve de verdade.
--   2. Este script agora só pede lock quando há TRABALHO A FAZER: não dropa política que não
--      existe, não liga RLS que já está ligada. E `lock_timeout` faz ele desistir rápido em vez
--      de disputar — falhar em 5s é melhor que travar o app.
--
-- Se mesmo assim der deadlock: rode o arquivo em duas metades (grants+laço, depois
-- user_settings+trigger). Cada execução commita e solta os locks.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Desiste em vez de disputar. Sem isto, o script prefere o deadlock à falha honesta.
set lock_timeout = '5s';

-- ── Grants: RLS filtra LINHAS, mas o GRANT é quem dá acesso à TABELA. Sem ele, a política
-- ── mais correta do mundo devolve "permission denied" (que ao menos é barulhento, não silencioso).
-- ── (GRANT pega lock leve — não é ele o problema do deadlock.)
grant select, insert, update, delete on public.user_tag_preferences      to authenticated;
grant select, insert, update, delete on public.attribute_bias            to authenticated;
grant select, insert, update, delete on public.user_attribute_assessment to authenticated;
grant select, insert, update, delete on public.ranking_filter_presets    to authenticated;
grant select, insert, update, delete on public.prediction_ledger         to authenticated;
grant select, insert, update, delete on public.prediction_snapshots      to authenticated;
grant select, insert, update, delete on public.recommendation_runs       to authenticated;
grant select, insert, update, delete on public.user_work_state           to authenticated;
grant select, update                 on public.user_settings             to authenticated;

-- ── Tabelas chaveadas por `user_id` (= auth.uid(); conferido: current_user_id == auth_user_id
-- ── == auth.uid() para todos os usuários, e todas as linhas per-user usam esse mesmo UUID).
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_tag_preferences',
    'attribute_bias',
    'user_attribute_assessment',
    'ranking_filter_presets',
    'prediction_ledger',
    'prediction_snapshots',
    'recommendation_runs',
    'user_work_state'
  ]
  loop
    -- Só liga a RLS se ela NÃO estiver ligada. `alter table` pega AccessExclusiveLock mesmo
    -- quando não muda nada — e são esses locks, segurados até o commit, que causaram o deadlock
    -- com o app lendo as mesmas tabelas.
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      execute format('alter table public.%I enable row level security', t);
    end if;

    -- Idempotência SEM `drop policy if exists`: dropar o que não existe custa o mesmo lock
    -- exclusivo que criar. Consultar pg_policies custa um lock leve no catálogo.
    -- Só as SUAS linhas. `using` filtra o que você enxerga; `with check` impede que você
    -- ESCREVA uma linha com o user_id de outra pessoa — é este que fecha o buraco do PR #127
    -- na camada do banco.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_own_select') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
        t || '_own_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_own_insert') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
        t || '_own_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_own_update') then
      execute format(
        'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
        t || '_own_update', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_own_delete') then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
        t || '_own_delete', t);
    end if;
  end loop;
end $$;

-- ── user_settings: a chave é `auth_user_id` (a ligação com a sessão), não `user_id`.
-- ── Sem INSERT nem DELETE: a linha nasce do trigger handle_new_user (mig 137) e ninguém a apaga
-- ── pela aplicação. E sem UPDATE do papel — ver o trigger abaixo.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_settings' and c.relrowsecurity
  ) then
    alter table public.user_settings enable row level security;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_settings' and policyname = 'user_settings_own_select') then
    create policy user_settings_own_select on public.user_settings
      for select to authenticated
      using (auth_user_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_settings' and policyname = 'user_settings_own_update') then
    create policy user_settings_own_update on public.user_settings
      for update to authenticated
      using (auth_user_id = (select auth.uid()))
      with check (auth_user_id = (select auth.uid()));
  end if;
end $$;

-- ⚠️ A política acima deixa o usuário atualizar a PRÓPRIA linha — e `role` mora nela. Sem o
-- guarda abaixo, qualquer Leitor faria `update user_settings set role='curador'` pela API e se
-- auto-promoveria: exatamente o buraco de self-upgrade que o PR #115 fechou, reaberto pelo outro
-- lado. Mesma coisa para o saldo da Anthropic.
--
-- O trigger vale para TODOS (a service role escapa da RLS, mas NÃO de um trigger), então ele
-- precisa distinguir quem é quem: `auth.uid()` é NULL na service role → passa direto.
-- `create or replace function` NÃO pega lock na tabela — só o trigger pega. Por isso a função
-- vem primeiro, incondicional, e o trigger é criado só se ainda não existir.
create or replace function public.guard_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor: sem sessão (auth.uid() nulo) → passa direto.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role so pode ser alterado pela service role (nao por auto-servico)';
  end if;
  if new.anthropic_balance_usd is distinct from old.anthropic_balance_usd
     or new.current_user_id is distinct from old.current_user_id
     or new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'campo protegido: so a service role altera';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'guard_role_self_escalation_trg'
      and tgrelid = 'public.user_settings'::regclass
  ) then
    create trigger guard_role_self_escalation_trg
      before update on public.user_settings
      for each row
      execute function public.guard_role_self_escalation();
  end if;
end $$;

comment on function public.guard_role_self_escalation is
  'Impede auto-promoção: com a política user_settings_own_update, o usuário pode atualizar a própria linha — e `role` mora nela. Sem este guarda, um Leitor viraria Curador por um UPDATE. auth.uid() é NULL na service role, que passa direto.';
