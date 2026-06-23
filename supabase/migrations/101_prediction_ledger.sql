-- ============================================================
-- 101 — prediction_ledger (validação prospectiva / prequential)
-- ============================================================
-- 1 linha quando uma obra ganha a PRIMEIRA user_score: congela a Nota
-- Prevista (e a Prioridade) de-registro — feitas SEM esse rótulo, então
-- out-of-sample por construção, sem leak — + o rótulo real que chegou
-- depois. Base do placar de ORDENAÇÃO (concordância par-a-par prospectiva)
-- e do MAE prospectivo (guarda-corpo). NÃO dá pra backfill: a previsão
-- pré-rótulo das obras já avaliadas não existe mais.
--
-- Per-user-ready; hoje user_id = singleton de user_settings.
-- `unique (user_id, work_id)`: só a PRIMEIRA nota vira ponto leak-free
-- (re-avaliar não conta — o modelo já viu o rótulo).
-- ============================================================

create table if not exists prediction_ledger (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  work_id               uuid not null references works(id) on delete cascade,
  -- Nota Prevista (expected_score) no instante em que a obra ainda não tinha nota.
  predicted_expected    numeric,
  -- Prioridade (decision_score) no mesmo instante — pra comparar se o rerank IA ajuda.
  predicted_decision    numeric,
  predicted_is_stub     boolean not null default false,
  -- rótulo verdadeiro que chegou depois.
  user_score            numeric not null,
  train_size_at_capture integer,
  captured_at           timestamptz not null default now(),
  unique (user_id, work_id)
);

create index if not exists prediction_ledger_user_idx
  on prediction_ledger (user_id, captured_at desc);

alter table prediction_ledger enable row level security;

comment on table prediction_ledger is
  'Log prequential append-only: Nota Prevista/Prioridade de-registro (pré-rótulo) + user_score real, por obra. Métrica de ordenação prospectiva. Sem leak por construção. Item de validação (PLANO-ATUAL §5).';
