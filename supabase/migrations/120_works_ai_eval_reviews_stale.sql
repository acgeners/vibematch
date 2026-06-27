-- ============================================================
-- 120 — Avaliação IA desatualizada por mudança de reviews
-- ============================================================
-- A avaliação IA de atributos usa as reviews como input (entram no prompt e no
-- input_hash). Quando o conjunto de reviews de uma obra MUDA depois da avaliação,
-- os category_scores ficam baseados num conjunto defasado. Espelha o
-- `alignment_stale` do Veredito IA: erguemos uma flag pra a fila "✨ Avaliar"
-- sinalizar quais obras re-avaliar (filtro "Reviews novas").
--
-- `reviews_hash`: fingerprint do conteúdo do pool de reviews (mantido por
--   saveWorkReviews). Muda só quando o conteúdo muda → evita falso positivo em
--   re-fetch idêntico.
-- `ai_eval_reviews_stale`: true quando o pool mudou numa obra com avaliação
--   concluída (ai_eval_status='done'). Limpa ao (re)avaliar.
-- ============================================================

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS reviews_hash TEXT,
  ADD COLUMN IF NOT EXISTS ai_eval_reviews_stale BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN works.reviews_hash IS
  'Fingerprint do conteúdo do pool de work_reviews (mantido por saveWorkReviews) — detecta mudança real de conteúdo.';
COMMENT ON COLUMN works.ai_eval_reviews_stale IS
  'true = o pool de reviews mudou após a avaliação IA (atributos defasados). Limpa ao re-avaliar. Espelha alignment_stale.';
