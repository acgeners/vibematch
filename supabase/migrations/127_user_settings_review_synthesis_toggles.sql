-- ============================================================
-- 127 — Toggles: gerar Resumo e Digest de reviews (síntese)
-- ============================================================
-- Liga/desliga GLOBALMENTE a geração dos dois artefatos derivados das reviews
-- externas, produzidos dentro de saveWorkReviews em QUALQUER save (criação e
-- atualização):
--   • review_summary_enabled → Resumo (Haiku) exibido na aba Notas & Avaliações.
--   • review_digest_enabled  → Digest (Sonnet) estruturado, insumo do consultor IA.
--
-- HABILITADOS por padrão (true) pra preservar o comportamento histórico (ambos
-- sempre rodavam no save). Desligados, o save persiste as reviews normalmente
-- mas NÃO gera o resumo/digest pago — o usuário gera sob demanda depois pela
-- seção "Síntese de reviews" em /settings. Freio de custo de tokens.
--
-- Lidos por getReviewSynthesisToggles (server/queries/current-user.ts) e
-- consumidos como gate em saveWorkReviews (lib/external/persist-reviews.ts).
-- Escritos por setReviewSummaryEnabled / setReviewDigestEnabled
-- (server/actions/settings.ts), expostos no card "Comportamento na criação".
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS review_summary_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS review_digest_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_settings.review_summary_enabled IS
  'Quando true (default), o Resumo de reviews (Haiku) é gerado ao salvar reviews de uma obra (criação/atualização). False adia a geração pra sob demanda.';

COMMENT ON COLUMN user_settings.review_digest_enabled IS
  'Quando true (default), o Digest de reviews (Sonnet) é gerado ao salvar reviews de uma obra (criação/atualização). False adia a geração pra sob demanda.';
