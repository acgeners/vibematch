-- ============================================================
-- 077 - calculated_scores.alignment_stale — Fase 1.5.1
-- ============================================================
-- Quando o offset de atributos muda (novo questionário pós-leitura),
-- os payloads de alignment cacheados (Smart Shortlist) ficam stale:
-- foram calculados sobre atributos não-calibrados ou com offset antigo.
--
-- Esta flag marca obras cujo alignment precisa ser recomputado. O
-- llm-reranker ignora o payload cacheado quando true e re-roda,
-- setando de volta pra false. Não acumula.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS alignment_stale BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN calculated_scores.alignment_stale IS
  'true = alignment_payload precisa ser recomputado (offset de atributos mudou). Reset pra false na próxima execução do Smart Shortlist.';
