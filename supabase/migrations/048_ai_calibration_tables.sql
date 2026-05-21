-- ============================================================
-- 048 - AI calibration: auditoria por obra + detecção de viés
-- ============================================================
-- Tabelas pra rastrear runs de calibração IA dos category_scores
-- e suas sugestões individuais.
--
-- audit  → IA olha cada obra com manual_score, sugere ajustes
--          em category_scores; auto-aplica abaixo de threshold.
-- bias   → análise agregada do catálogo, gera relatório de viés
--          sistemático por critério (sem alterar scores).
-- ============================================================

-- Expande enum de category_scores.source pra incluir 'ai_calibrated'.
ALTER TABLE category_scores
  DROP CONSTRAINT IF EXISTS category_scores_source_valid;

ALTER TABLE category_scores
  ADD CONSTRAINT category_scores_source_valid
  CHECK (source IN ('manual','imported','ai_accepted','ai_edited','ai_calibrated'));

CREATE TABLE IF NOT EXISTS calibration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('audit','bias')),
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  n_works_scanned INTEGER NOT NULL DEFAULT 0,
  n_suggestions INTEGER NOT NULL DEFAULT 0,
  n_auto_applied INTEGER NOT NULL DEFAULT 0,
  bias_report JSONB,
  taste_profile_id UUID REFERENCES taste_profile(id) ON DELETE SET NULL,
  auto_apply_min_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  auto_apply_max_delta NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS calibration_runs_mode_created_idx
  ON calibration_runs (mode, created_at DESC);

CREATE TABLE IF NOT EXISTS score_calibration_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES calibration_runs(id) ON DELETE CASCADE,
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  criterion_slug TEXT NOT NULL,
  previous_score NUMERIC(4,2) NOT NULL,
  previous_source TEXT NOT NULL,
  suggested_score NUMERIC(4,2) NOT NULL CHECK (suggested_score BETWEEN 0 AND 10),
  delta NUMERIC(5,2) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  justification TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('pending','auto_applied','accepted','rejected','edited','reverted')
  ),
  applied_score NUMERIC(4,2),
  applied_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, work_id, criterion_slug)
);

CREATE INDEX IF NOT EXISTS score_calibration_suggestions_pending_idx
  ON score_calibration_suggestions (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS score_calibration_suggestions_work_idx
  ON score_calibration_suggestions (work_id);

CREATE INDEX IF NOT EXISTS score_calibration_suggestions_run_idx
  ON score_calibration_suggestions (run_id);

COMMENT ON TABLE calibration_runs IS
  'Cada execução de calibração IA — audit (sugestões por obra) ou bias (relatório global).';
COMMENT ON COLUMN calibration_runs.bias_report IS
  'Preenchido apenas em mode=bias. JSON com bias_estimate/dispersion/recommendation por critério.';
COMMENT ON TABLE score_calibration_suggestions IS
  'Sugestões individuais de ajuste de category_scores geradas em runs de audit.';
COMMENT ON COLUMN score_calibration_suggestions.previous_score IS
  'Snapshot do score antes da aplicação — usado para revert.';

ALTER TABLE calibration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_calibration_suggestions ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
