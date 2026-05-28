-- ============================================================
-- 065 - Backfill calculated_scores.alignment_score a partir de
--       recommendation_runs.results (todas as runs, qualquer modo).
-- ============================================================
-- Até a migration anterior, o action de recomendação só persistia
-- alignment_score em calculated_scores quando o modo era "ranking".
-- Runs de favoritos (next_read / full_analysis) ficavam só dentro de
-- recommendation_runs.results e nunca apareciam na coluna IA Rk das
-- tabelas. Esse backfill pega o alignment_score mais recente de cada
-- obra (independente do modo) e popula calculated_scores, evitando
-- ter que re-rodar a IA (que custaria tokens).
--
-- Só sobrescreve se a run for mais nova que o alignment_at atual —
-- preserva re-ranks single-work feitos depois da última run.
-- ============================================================

WITH latest_per_work AS (
  SELECT DISTINCT ON ((res.value->>'work_id')::uuid)
    (res.value->>'work_id')::uuid AS work_id,
    (res.value->>'alignment_score')::numeric AS alignment_score,
    res.value->>'justification' AS alignment_justification,
    rr.id AS alignment_run_id,
    rr.created_at AS alignment_at
  FROM recommendation_runs rr
  CROSS JOIN LATERAL jsonb_array_elements(rr.results) AS res(value)
  WHERE res.value->>'work_id' IS NOT NULL
    AND res.value->>'alignment_score' IS NOT NULL
  ORDER BY (res.value->>'work_id')::uuid, rr.created_at DESC
)
INSERT INTO calculated_scores (
  work_id,
  alignment_score,
  alignment_justification,
  alignment_run_id,
  alignment_at
)
SELECT
  lpw.work_id,
  lpw.alignment_score,
  lpw.alignment_justification,
  lpw.alignment_run_id,
  lpw.alignment_at
FROM latest_per_work lpw
WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = lpw.work_id)
ON CONFLICT (work_id) DO UPDATE
SET
  alignment_score = EXCLUDED.alignment_score,
  alignment_justification = EXCLUDED.alignment_justification,
  alignment_run_id = EXCLUDED.alignment_run_id,
  alignment_at = EXCLUDED.alignment_at
WHERE
  calculated_scores.alignment_at IS NULL
  OR calculated_scores.alignment_at < EXCLUDED.alignment_at;
