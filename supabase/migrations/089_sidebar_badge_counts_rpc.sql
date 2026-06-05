-- ============================================================
-- 089 - RPC get_sidebar_badge_counts: totais dos badges de
--       pendência da sidebar, agregados no Postgres.
-- ============================================================
-- Os badges "Avaliação IA (N)" e "Configurações (N)" eram
-- calculados carregando centenas de linhas por navegação. Esta
-- função agrega tudo server-side (conta com índice, sem trafegar
-- linhas) e devolve só os dois inteiros. Exata e sem cache/drift.
--
-- ai_eval_total  = nº de obras DISTINTAS nos filtros padrão de
--   /ai-evaluation: atributos pendentes ∪ IA Rk stale ∪ Interesse
--   Sinopse desatualizado/não previsto.
-- settings_total = SOMA das pendências do Pipeline de dados de
--   /settings: embeddings ausentes + sinopse canônica faltando +
--   resumo de reviews faltando (tarefas independentes).
--
-- `synopsis_prompt_version` é passado pelo app (constante
-- PROMPT_VERSION do synopsis-quality-predictor) pra a função não
-- precisar hardcodar a versão atual.
-- ============================================================

CREATE OR REPLACE FUNCTION get_sidebar_badge_counts(synopsis_prompt_version TEXT)
RETURNS TABLE (
  ai_eval_total INT,
  settings_total INT
)
LANGUAGE sql STABLE
AS $$
  WITH ai_eval AS (
    -- Atributos: ai_eval_status ∈ {pending, review_pending}
    SELECT w.id
    FROM works w
    WHERE w.is_archived = false
      AND w.ai_eval_status IN ('pending', 'review_pending')
    UNION
    -- IA Rk "stale": tem alignment_score e alignment_stale
    SELECT w.id
    FROM works w
    JOIN calculated_scores cs ON cs.work_id = w.id
    WHERE w.is_archived = false
      AND cs.alignment_stale = true
      AND cs.alignment_score IS NOT NULL
    UNION
    -- Interesse Sinopse: sinopse canônica SEM previsão fresca
    -- (versão atual e não-stale)
    SELECT w.id
    FROM works w
    WHERE w.is_archived = false
      AND w.canonical_synopsis IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM synopsis_quality_predictions p
        WHERE p.work_id = w.id
          AND p.prompt_version = synopsis_prompt_version
          AND p.stale IS NOT TRUE
      )
  )
  SELECT
    (SELECT count(*) FROM ai_eval)::int AS ai_eval_total,
    (
      -- embeddings ausentes (obra não-arquivada sem linha em work_embeddings)
      (SELECT count(*) FROM works w
        WHERE w.is_archived = false
          AND NOT EXISTS (SELECT 1 FROM work_embeddings e WHERE e.work_id = w.id))
      -- sinopse canônica faltando
      + (SELECT count(*) FROM works w
        WHERE w.is_archived = false
          AND w.canonical_synopsis IS NULL)
      -- resumo de reviews faltando (obra com ≥1 review e sem review_summary)
      + (SELECT count(*) FROM works w
        WHERE w.is_archived = false
          AND w.review_summary IS NULL
          AND EXISTS (SELECT 1 FROM work_reviews r WHERE r.work_id = w.id))
    )::int AS settings_total;
$$;

COMMENT ON FUNCTION get_sidebar_badge_counts(TEXT) IS
  'Totais dos badges de pendência da sidebar (Avaliação IA distinto / Configurações soma), agregados server-side.';
