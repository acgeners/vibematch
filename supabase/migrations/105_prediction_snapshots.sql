-- ============================================================
-- 105 — prediction_snapshots (validação PROSPECTIVA rica / prequential)
-- ============================================================
-- Camada ADITIVA e NÃO-DESTRUTIVA sobre o prediction_ledger (101).
--
-- Diferença pro ledger 101: aquele grava 1 linha por obra no instante da
-- PRIMEIRA nota (resolve no mesmo evento, unique(user_id, work_id)). ESTA tabela
-- registra MÚLTIPLOS snapshots IMUTÁVEIS por obra — 1 por contexto/fórmula/mood
-- por dia — tirados em eventos relevantes (ex.: obra exibida numa recomendação)
-- ANTES de a nota real existir, e os RESOLVE depois, quando a nota chega.
-- O ledger 101 e a função capturePredictionForFirstRating seguem INTACTOS.
--
-- Imutável por construção: os campos do SNAPSHOT nunca são sobrescritos. A única
-- escrita posterior permitida é a RESOLUÇÃO (actual_user_score, resolved_at,
-- superseded, label_changed_at). Os ERROS (abs/sq/signed) NÃO são persistidos
-- (Opção A): são derivados de predicted_score/actual_user_score nas funções
-- puras de métrica — impossível ficarem inconsistentes com as notas.
--
-- Dedup (dedup_key, único): regra DEPENDE do contexto —
--   • recomendação/ranking → `ranking::{ranking_snapshot_id}::work::{work_id}`:
--     cada execução do ranking preserva seu conjunto COMPLETO; a mesma obra pode
--     ter vários snapshots no mesmo dia se aparecer em rankings diferentes
--     (necessário pra NDCG/Precision/regret/Spearman por ranking);
--   • eventos individuais (work_opened/want_to_read/comparison/manual) →
--     `event::{user}::{work}::{formula}::{context}::{mood}::{dia America/Sao_Paulo}`.
--   (montado no serviço; ver lib/server/predictions/prediction-context.ts)
--
-- Per-user-ready; hoje user_id = singleton de user_settings.
-- RLS ligado sem policy (anon bloqueado; service role ignora RLS) — igual ao
-- resto do schema.
-- ============================================================

create table if not exists prediction_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  work_id               uuid not null references works(id) on delete cascade,

  -- ── Snapshot da previsão (IMUTÁVEL após inserção) ──
  predicted_score       numeric,    -- expected_score (Nota Prevista) 0–10
  calc_score            numeric,    -- Nota.Calc 0–10
  personal_fit          numeric,    -- afinidade 0–1
  alignment_score       numeric,    -- Veredito IA 0–100 (NULL se não rankeada)
  decision_score        numeric,    -- Prioridade 0–10
  tier                  integer,    -- banda de prioridade no momento (1 = topo)
  tier_band_width       numeric,    -- largura da banda usada no snapshot
  predicted_is_stub     boolean not null default false,

  -- ── Contexto (pra reproduzir/segmentar a previsão) ──
  formula_version       text not null,
  model_version         text,
  prompt_version        text,
  training_sample_size  integer,
  cv_mae                numeric,
  mood_key              text,
  prediction_context    text not null,   -- 'recommendation' | 'work_opened' | 'manual_snapshot' | ...
  ranking_snapshot_id   uuid,            -- agrupa obras recomendadas/rankeadas juntas

  -- ── Dedup determinístico (ver comentário no topo) ──
  dedup_key             text not null,

  -- ── Resultado posterior (RESOLUÇÃO) ──
  -- SÓ a nota real + timestamps. Os erros derivados NÃO são persistidos (Opção
  -- A): calculados nas funções puras a partir de predicted_score/actual.
  actual_user_score     numeric,         -- 1ª nota observada APÓS o snapshot (imutável)
  resolved_at           timestamptz,
  -- nota EDITADA/REMOVIDA depois da resolução = AUDITORIA, não invalidação: a 1ª
  -- medição (predição × 1ª nota) PERMANECE nas métricas; só carimba quando mudou.
  label_changed_at      timestamptz,
  -- INVALIDAÇÃO MANUAL: observação inutilizável (nota registrada por erro,
  -- snapshot inválido, problema técnico). NÃO é setado por edição normal de nota.
  -- Métricas excluem superseded.
  superseded            boolean not null default false,

  captured_at           timestamptz not null default now(),

  unique (dedup_key),

  constraint prediction_snapshots_predicted_range
    check (predicted_score is null or (predicted_score >= 0 and predicted_score <= 10)),
  constraint prediction_snapshots_actual_range
    check (actual_user_score is null or (actual_user_score >= 0 and actual_user_score <= 10)),
  constraint prediction_snapshots_tier_positive
    check (tier is null or tier > 0),
  constraint prediction_snapshots_band_positive
    check (tier_band_width is null or tier_band_width > 0),
  -- resolved_at nunca antes da captura; label só muda depois de resolver.
  constraint prediction_snapshots_resolved_coherent
    check (resolved_at is null or resolved_at >= captured_at),
  constraint prediction_snapshots_label_change_coherent
    check (label_changed_at is null or resolved_at is not null)
);

-- Índices só pros filtros/agrupamentos realmente usados pelas métricas:
--  (user_id, work_id)        → resolução por obra (lookup no save da nota).
--  (resolved_at)             → métricas sobre resolvidas + por período.
--  (formula_version)         → segmentação por versão da fórmula.
--  (ranking_snapshot_id)     → métricas de ranking (agrupa obras de uma run).
create index if not exists prediction_snapshots_work_idx
  on prediction_snapshots (user_id, work_id);
create index if not exists prediction_snapshots_resolved_idx
  on prediction_snapshots (resolved_at);
create index if not exists prediction_snapshots_formula_idx
  on prediction_snapshots (formula_version);
create index if not exists prediction_snapshots_ranking_idx
  on prediction_snapshots (ranking_snapshot_id);

alter table prediction_snapshots enable row level security;

comment on table prediction_snapshots is
  'Snapshots prospectivos imutáveis (pré-rótulo) + resolução posterior. Aditivo ao prediction_ledger (101). Base das métricas prospectivas (MAE/RMSE/ranking) por contexto/fórmula/período. AUDIT_REPORT P1.';
