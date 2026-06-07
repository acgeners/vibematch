-- ============================================================
-- 091 - get_sidebar_badge_counts: Interesse Sinopse no badge
--       passa a contar só "não previsto" (sem desatualizadas)
-- ============================================================
-- Antes, a parcela de Interesse Sinopse do badge "Avaliação IA"
-- contava obras SEM previsão FRESCA — ou seja "não previsto" +
-- "desatualizado". Como uma regeneração de perfil pode marcar
-- centenas de previsões como stale de uma vez, isso inflava o
-- badge. Agora conta só "não previsto": sinopse canônica e SEM
-- nenhuma previsão (qualquer versão). Desatualizadas saem do badge.
--
-- "Não previsto" independe da versão do prompt, então o parâmetro
-- `synopsis_prompt_version` deixou de ser usado e a função volta a
-- ser SEM argumentos. O caller (server/actions/badges.ts) chama sem
-- args; enquanto esta migration não é aplicada, o caller cai no
-- fallback TS (que já reflete a nova regra). DROP necessário porque
-- CREATE OR REPLACE não troca a assinatura.
-- ============================================================

DROP FUNCTION IF EXISTS get_sidebar_badge_counts(TEXT);

CREATE OR REPLACE FUNCTION get_sidebar_badge_counts()
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
    -- Interesse Sinopse: sinopse canônica SEM nenhuma previsão (não previsto)
    SELECT w.id
    FROM works w
    WHERE w.is_archived = false
      AND w.canonical_synopsis IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM synopsis_quality_predictions p
        WHERE p.work_id = w.id
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

COMMENT ON FUNCTION get_sidebar_badge_counts() IS
  'Totais dos badges de pendência da sidebar (Avaliação IA distinto / Configurações soma), agregados server-side. Interesse Sinopse conta só "não previsto" (sem previsão alguma).';
