-- 220 — Lote de reviews do catálogo: `works.reviews_checked_at` + RPC `work_review_growth`.
--
-- ✅ APLICADA NA NUVEM em 2026-11-12, por psql como `postgres`, em transação com conferência antes do
-- commit (UPDATE 359). Backup completo antes: `.backups/2026-11-12T03-56-49-531Z`. ORDEM DE DEPLOY:
-- 220 → código. O código que a acompanha LÊ a coluna (painel "Reviews do catálogo") e chama a função
-- (fila "Reviews novas" de /curation/works); publicado antes dela, as duas leituras falham.
--
-- POR QUE (medido em 2026-11-11):
--   · A fila "Reviews novas" tinha 770 obras e só dizia SIM/NÃO (`works.ai_eval_reviews_stale`). Não
--     dava para saber QUAIS ganharam mais, e era isso que decidia qual reavaliar primeiro.
--   · O lote de capítulos não podia levar as reviews junto: ele roda em 0,6 s por obra (349 obras em
--     4 min) e a busca de reviews leva ~37 s por obra (o Mangago faz uma requisição por review e está
--     em 919 das 1.077 obras ativas). Daí um lote PRÓPRIO, que precisa de uma data de "última busca"
--     para recomeçar de onde parou — irmã de `chapters_checked_at`.
--
-- `work_review_growth` DERIVA o crescimento em vez de gravá-lo: conta as reviews ÚTEIS criadas DEPOIS
-- da avaliação vigente. Ensaiado na nuvem antes de escrever esta função: nas obras SEM a marca "Reviews
-- novas", 263 de 266 dão zero, como deveriam; nas 770 com a marca, só 7 dão zero.
--   · "Útil" é a MESMA régua de `work_card_counts` (migration 122), que desenha o 💬 do card: em
--     `work_reviews`, `text_length >= 40`; nas manuais, `char_length(btrim(text)) >= 40`. Com a mesma
--     régua, o "tinha M" da tela é exatamente o 💬 menos o N — duas réguas fariam a conta não fechar.
--   · "Avaliação vigente" é a MESMA do card: a `completed` mais recente por `created_at` (desempate
--     por `id`), com a data `coalesce(updated_at, created_at)` — é a "Data avaliação" que a fila imprime.
--   · ⚠️ A régua depende de uma linha de `work_reviews` NUNCA ser regravada depois da avaliação (a
--     regravação zeraria o `created_at` e inflaria o N). Hoje só a criação da obra apaga e regrava
--     (`createWork`/`createWorksBatch`); todo o resto grava em modo acumulativo. Guardado por
--     `tests/unit/reviews/crescimento-desde-avaliacao.test.ts`.
--
-- 🔴 O ÚNICO DADO QUE ELA MEXE: o `created_at` das reviews gravadas pela CRIAÇÃO da obra. No Path B
-- (`createWork`/`createWorksBatch` com avaliação) a avaliação é inserida ANTES e as reviews que ela
-- LEU entram depois, num `after()`. Pela régua acima elas contavam como "novas": a obra aparecia
-- com "+43 desde a avaliação (tinha 0)" sem ter ganhado nada, e ia para o topo da fila. Medido em
-- 2026-11-12 nas avaliações de criação (as que só têm `criteriaJustifications` no `raw_response`):
-- 325 reviews entraram até 2 min depois delas, e as seguintes só mais de 1 DIA depois — o vão é
-- limpo, por isso a janela de 10 min abaixo. Contando também as avaliações de criação já
-- substituídas, o UPDATE toca 359 linhas (ensaio de 2026-11-12 em transação com rollback: a 2ª
-- passada acha 0; nas 770 obras com a marca, 7 dão +0; nas 266 sem ela, 264 dão +0; a função
-- percorre o catálogo inteiro em 65 ms). Esta migration as traz para a data da avaliação (o
-- que elas foram: parte do que ela leu); o código passa a gravar assim desde a origem
-- (`saveWorkReviews` com `fromFreshEval`). O backup semanal guarda o `created_at` anterior.
--
-- O QUE NÃO FAZ: não toca mais nenhuma linha (coluna nula = "nunca buscada"; adicionar coluna nula
-- sem default é só metadado). A função é `stable` e não escreve.
--
-- IDEMPOTENTE (a 2ª execução não acha mais review dentro da janela). ROLLBACK:
-- `scripts/rollback/220_rollback.sql` (o ajuste de `created_at` não volta — está no backup).

alter table public.works add column if not exists reviews_checked_at timestamptz;

comment on column public.works.reviews_checked_at is
  'Última busca de reviews COMPLETA (nenhuma fonte falhou) pelo lote "Reviews do catálogo". Nula = nunca. Ordena o lote: as nunca buscadas primeiro, depois as mais antigas.';

-- As reviews que a avaliação de CRIAÇÃO leu passam a ter a data dela (ver o cabeçalho).
update public.work_reviews wr
set created_at = e.at
from (
  select ev.work_id, coalesce(ev.updated_at, ev.created_at) as at
  from public.ai_evaluations ev
  where ev.status = 'completed'
    and ev.raw_response ? 'criteriaJustifications'
    and not (ev.raw_response ? 'evaluationContext')
) e
where wr.work_id = e.work_id
  and wr.created_at > e.at
  and wr.created_at <= e.at + interval '10 minutes';

create or replace function public.work_review_growth(work_ids uuid[])
returns table (work_id uuid, evaluated_at timestamptz, new_useful integer)
language sql
stable
as $$
  with ev as (
    select distinct on (e.work_id)
      e.work_id,
      coalesce(e.updated_at, e.created_at) as at
    from ai_evaluations e
    where e.status = 'completed'
      and e.work_id = any (work_ids)
    order by e.work_id, e.created_at desc, e.id desc
  ),
  r as (
    select wr.work_id, count(*) as cnt
    from work_reviews wr
    join ev on ev.work_id = wr.work_id
    where wr.text_length >= 40
      and wr.created_at > ev.at
    group by wr.work_id
  ),
  m as (
    select wm.work_id, count(*) as cnt
    from work_external_reviews_manual wm
    join ev on ev.work_id = wm.work_id
    where char_length(btrim(wm.text)) >= 40
      and wm.created_at > ev.at
    group by wm.work_id
  )
  select
    ev.work_id,
    ev.at as evaluated_at,
    (coalesce(r.cnt, 0) + coalesce(m.cnt, 0))::int as new_useful
  from ev
  left join r on r.work_id = ev.work_id
  left join m on m.work_id = ev.work_id;
$$;

comment on function public.work_review_growth(uuid[]) is
  'Por obra: data da avaliação vigente e quantas reviews úteis (mesma régua de work_card_counts) entraram depois dela. Obra sem avaliação concluída não aparece.';
