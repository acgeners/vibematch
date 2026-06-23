-- ============================================================
-- 115 - get_sidebar_badge_counts: ai_eval_total volta a ser
--       só a fila de ATRIBUTOS (pending + review_pending).
-- ============================================================
-- OPCIONAL / NÃO BLOQUEANTE. A correção do badge já vale sem
-- aplicar esta migration: `server/actions/badges.ts` passou a
-- contar `aiEval` direto em TS (getAttributesQueueCount) e usa a
-- RPC apenas para `settings_total`. Esta migration só realinha a
-- própria RPC pra:
--   1) não MENTIR (ai_eval_total era a UNIÃO de 3 filas — atributos
--      ∪ Veredito IA stale ∪ Interesse Sinopse não-previsto — que
--      inflava o badge, sobretudo após regen de perfil); e
--   2) não COMPUTAR a união cara à toa a cada carga de página (a RPC
--      é chamada pelo badge só pra ler settings_total).
--
-- Agora ai_eval_total = obras não-arquivadas com
-- ai_eval_status ∈ {pending, review_pending}. As filas de Veredito
-- IA e Interesse Sinopse têm seus próprios contadores na página
-- /ai-evaluation e ficam FORA do badge da sidebar.
--
-- settings_total é mantido idêntico.
-- ============================================================

CREATE OR REPLACE FUNCTION get_sidebar_badge_counts()
RETURNS TABLE (
  ai_eval_total INT,
  settings_total INT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    -- Fila de ATRIBUTOS: ai_eval_status ∈ {pending, review_pending}
    (SELECT count(*) FROM works w
      WHERE w.is_archived = false
        AND w.ai_eval_status IN ('pending', 'review_pending'))::int AS ai_eval_total,
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
  'Totais dos badges da sidebar. ai_eval_total = fila de atributos (pending + review_pending); settings_total = soma das pendências do Pipeline de dados. Veredito IA / Interesse Sinopse NÃO entram no badge (contadores próprios na página).';
