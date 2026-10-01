-- 201 · Arte (v32) na MESMA chamada da avaliação dos 11 — uma linha por avaliação.
--
-- 🔴 NÃO APLICADA. Criada em 2026-10-01 na branch `feat/art-canonical`. Aplicar exige autorização
-- própria.
--
-- ORDEM: indiferente, e de propósito. O código grava a Arte em modo FAIL-SOFT
-- (`server/actions/ai.ts`): com o código no ar e a tabela ainda ausente, o insert falha, vira log
-- e os 11 seguem gravados e revisáveis. Com a tabela criada antes do código, ela só fica vazia.
--
-- O QUE É:
--   · `ai_evaluation_id` é PK e FK para `ai_evaluations` (ON DELETE CASCADE): modelo, versão de
--     prompt, input_hash e a linha de `ai_api_calls` são os da MESMA avaliação — a proveniência
--     vem da associação, não é copiada;
--   · QUALIDADE categórica (sem 0–10), com a força da evidência calculada por código;
--   · MUDANÇA/CONSISTÊNCIA marcada como EXPERIMENTAL (`change_experimental`, só aceita true):
--     coletada para acumular dado, fora de scoring, ranking, filtro e recomendação.
--
-- O QUE NÃO FAZ: não toca scoring, `category_scores`, `works.art_signal`/`art_estimate`/
-- `art_percentile`, nem nenhuma avaliação antiga. SEM backfill: avaliação sem linha aqui
-- significa "Arte não avaliada" — diferente de `abstained` (Arte avaliada, sem evidência).
--
-- REVERTER: `drop table public.ai_evaluation_art;` (nada depende dela).

create table if not exists public.ai_evaluation_art (
  ai_evaluation_id  uuid primary key references public.ai_evaluations(id) on delete cascade,
  work_id           uuid not null references public.works(id) on delete cascade,
  signal_version    text not null,
  status            text not null check (status in ('rated', 'abstained', 'invalid')),

  -- QUALIDADE
  quality_signal    text not null
    check (quality_signal in ('ABOVE_AVERAGE', 'AVERAGE', 'BELOW_AVERAGE', 'INCONCLUSIVE')),
  quality_strength  text check (quality_strength in ('LOW', 'MEDIUM', 'HIGH')),
  quality_agreement numeric(4, 3) check (quality_agreement between 0 and 1),
  judging_count     integer not null default 0 check (judging_count >= 0),
  positive_count    integer not null default 0 check (positive_count >= 0),
  negative_count    integer not null default 0 check (negative_count >= 0),
  competent_count   integer not null default 0 check (competent_count >= 0),
  mixed_count       integer not null default 0 check (mixed_count >= 0),
  judging_reviews   jsonb not null default '[]'::jsonb,
  quality_evidence  jsonb not null default '[]'::jsonb,
  justification     text not null default '',

  -- MUDANÇA / CONSISTÊNCIA — 🧪 experimental
  change_signal     text not null
    check (change_signal in ('NO_CLEAR_SIGNAL', 'CHANGE_NOTED', 'PROBLEMATIC_CHANGE')),
  change_direction  text check (change_direction in ('IMPROVED', 'WORSENED', 'MIXED_OR_UNCLEAR')),
  change_evidence   jsonb not null default '[]'::jsonb,
  change_strength   text check (change_strength in ('LOW', 'MEDIUM', 'HIGH')),
  change_experimental boolean not null default true check (change_experimental),

  -- auditoria: rebaixamentos, descartes e o apêndice que foi ao prompt (as citações A… apontam para ele)
  normalization     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),

  -- coerência que o validador já garante, travada também no banco
  constraint ai_evaluation_art_contagens_somam
    check (judging_count = positive_count + negative_count + competent_count + mixed_count),
  constraint ai_evaluation_art_forca_so_com_direcao
    check ((quality_signal = 'INCONCLUSIVE') = (quality_strength is null)),
  constraint ai_evaluation_art_status_segue_qualidade
    check ((status = 'rated') = (quality_signal <> 'INCONCLUSIVE')),
  constraint ai_evaluation_art_direcao_so_com_mudanca
    check ((change_signal = 'NO_CLEAR_SIGNAL') = (change_direction is null))
);

-- "A Arte atual da obra" = a da avaliação concluída mais recente.
create index if not exists ai_evaluation_art_work_created_idx
  on public.ai_evaluation_art (work_id, created_at desc);

-- Catálogo: só a service role lê e grava (como `ai_evaluation_scores`); o cliente anônimo não lê nada.
alter table public.ai_evaluation_art enable row level security;
