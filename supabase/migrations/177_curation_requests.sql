-- ============================================================
-- 177 — curation_requests: o leitor PEDE, o curador roda local
-- ============================================================
-- Produção não tem sidecar nem FlareSolverr (medido em 2026-08-04: pagá-los custaria
-- US$11–17/mês, e sem eles a busca colhe 6 das 9 fontes). A decisão foi centralizar no
-- CURADOR, que roda no Mac onde o bypass é grátis. Esta tabela é o canal do leitor para
-- pedir o que ele não pode mais fazer.
--
-- ⚠️ CADASTRO NOVO NÃO PASSA POR AQUI. `works.ai_eval_status = 'pending'` já significa
-- "obra criada, esperando enriquecimento" e já alimenta o badge de curadoria. Duplicar
-- isso numa linha de pedido criaria duas fontes de verdade para o mesmo fato — e a que
-- desincronizasse seria descoberta meses depois. Aqui entram só os três casos que o
-- estado da obra NÃO expressa:
--
--   update_data     — obra já `done`, o leitor quer os dados re-hidratados das fontes
--   review_eval     — obra já `done`, o leitor discorda/duvida da avaliação de IA
--   create_by_name  — a busca não achou nada. Sem work_id: a obra não existe ainda.
--
-- O terceiro existe por causa de uma decisão de produto: cadastro é SÓ pela busca, sem
-- digitar obra na mão (assim toda obra nasce com ≥1 fonte e o enriquecimento vira
-- hidratação por ID em vez de adivinhação por título). Só que obra que existe apenas no
-- ComicK, Mangago ou Comix é invisível para a busca de produção — o leitor procuraria,
-- não acharia, e travaria ali. O pedido resolve sem abrir exceção.
-- ============================================================

set lock_timeout = '5s';

create table if not exists public.curation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- Nulo SÓ em `create_by_name` — a obra ainda não existe. O check abaixo amarra os dois.
  work_id uuid references public.works(id) on delete cascade,
  kind text not null check (kind in ('update_data', 'review_eval', 'create_by_name')),
  -- O que o leitor digitou quando a busca não achou. Só em `create_by_name`.
  query text,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,

  -- Amarra forma e conteúdo: sem isto dá para gravar um `update_data` sem obra (que o
  -- curador não teria como atender) ou um `create_by_name` apontando para obra que já
  -- existe (que é outro pedido). Constraint em vez de validação só no app porque a
  -- action é `"use server"`, ou seja, endpoint público.
  constraint curation_requests_forma check (
    (kind = 'create_by_name' and work_id is null and query is not null and length(btrim(query)) > 0)
    or (kind <> 'create_by_name' and work_id is not null and query is null)
  )
);

-- UM pedido em aberto por pessoa, por obra, por tipo. Sem isto, o botão "pedir
-- atualização" vira gerador de linhas: a mesma pessoa clicando três vezes enche a fila
-- do curador com o mesmo trabalho. Parcial em `status = 'open'` de propósito — pedido
-- já resolvido não bloqueia um novo daqui a seis meses.
create unique index if not exists curation_requests_aberto_por_obra_idx
  on public.curation_requests (user_id, work_id, kind)
  where status = 'open' and work_id is not null;

-- Mesma regra para o pedido sem obra, comparando o nome normalizado: "Berserk" e
-- " berserk " são o mesmo pedido.
create unique index if not exists curation_requests_aberto_por_nome_idx
  on public.curation_requests (user_id, lower(btrim(query)))
  where status = 'open' and work_id is null;

-- A fila do curador é sempre "abertos, mais antigo primeiro" (quem pediu antes espera
-- menos). O índice cobre exatamente esse predicado.
create index if not exists curation_requests_fila_idx
  on public.curation_requests (status, created_at)
  where status = 'open';

alter table public.curation_requests enable row level security;

-- GRANT + políticas (padrão da 142). O curador lê a fila INTEIRA pela service role, que
-- ignora RLS — as políticas abaixo são sobre o cliente de sessão, e por isso só falam do
-- dono. `update` só existe para o leitor cancelar o próprio pedido; resolver é do curador
-- e passa pela service role.
grant select, insert, update, delete on public.curation_requests to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'curation_requests'
                    and policyname = 'curation_requests_own_select') then
    create policy curation_requests_own_select on public.curation_requests
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'curation_requests'
                    and policyname = 'curation_requests_own_insert') then
    create policy curation_requests_own_insert on public.curation_requests
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'curation_requests'
                    and policyname = 'curation_requests_own_update') then
    create policy curation_requests_own_update on public.curation_requests
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'curation_requests'
                    and policyname = 'curation_requests_own_delete') then
    create policy curation_requests_own_delete on public.curation_requests
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on table public.curation_requests is
  'Pedidos do leitor para o curador (atualizar dados, revisar avaliação, cadastrar pelo nome). '
  'Cadastro de obra NÃO entra aqui: works.ai_eval_status = ''pending'' já expressa isso.';
comment on column public.curation_requests.query is
  'O nome digitado quando a busca não achou nada. Só em create_by_name — nos outros o alvo é work_id.';
