-- ============================================================
-- 121 — "Pular" obra na fila de Interesse na Obra
-- ============================================================
-- Espelha o `ai_eval_status='skipped'` da fila de atributos: marca uma obra como
-- pulada na aba "Interesse na Obra" (/ai-evaluation?tab=sinopse) pra ela sair da
-- fila (não aparece, não vira alvo do "Aplicar previsão em fila"). NÃO toca em
-- synopsis_quality nem na proveniência — é ortogonal ao valor/fonte do Interesse.
--
-- Lido por getSynopsisQueueWorks (exclui skipped, via probe defensivo).
-- Escrito por skipSynopsisInterestAction / unskipSynopsisInterestAction.
-- ============================================================

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS synopsis_interest_skipped BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN works.synopsis_interest_skipped IS
  'true = obra pulada na fila de Interesse na Obra (sai da fila e do "Aplicar em fila"). Ortogonal a synopsis_quality/source.';
