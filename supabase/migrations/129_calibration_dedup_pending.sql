-- ============================================================
-- 129 - Dedup de sugestões de calibração pendentes
-- ============================================================
-- Bug: score_calibration_suggestions só tinha UNIQUE (run_id,
-- work_id, criterion_slug) — único DENTRO de uma run. Cada
-- runCalibrationAuditAction varre o catálogo inteiro e insere
-- uma linha nova por (obra, atributo), sem substituir a pendente
-- anterior. Rodar a auditoria N vezes empilha N pendentes do
-- mesmo par → a mesma obra aparece repetida pro mesmo atributo
-- na aba "Pendentes".
--
-- Fix (3 partes):
--   1. Novo status 'superseded' — a pendente antiga vira arquivada
--      (some da UI e do badge, mas fica no banco, auditável).
--   2. Limpeza do backlog: mantém a pendente MAIS RECENTE por
--      (work_id, criterion_slug); as demais viram 'superseded'.
--   3. Índice único parcial sobre pendentes → impossível empilhar
--      duplicata de novo (o app substitui a anterior antes de
--      inserir; ver runCalibrationAuditAction).
-- ============================================================

-- 1. Permite o novo status 'superseded' no CHECK.
ALTER TABLE score_calibration_suggestions
  DROP CONSTRAINT IF EXISTS score_calibration_suggestions_status_check;

ALTER TABLE score_calibration_suggestions
  ADD CONSTRAINT score_calibration_suggestions_status_check
  CHECK (
    status IN (
      'pending','auto_applied','accepted','rejected',
      'edited','reverted','superseded'
    )
  );

-- 2. Limpeza: para cada (work_id, criterion_slug) com >1 pendente,
--    mantém só a mais recente (created_at, desempate por id) e marca
--    as anteriores como 'superseded'. Precisa rodar ANTES do índice
--    único parcial (senão a criação falha nas duplicatas existentes).
UPDATE score_calibration_suggestions s
SET status = 'superseded',
    reviewed_at = now()
WHERE s.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM score_calibration_suggestions s2
    WHERE s2.work_id = s.work_id
      AND s2.criterion_slug = s.criterion_slug
      AND s2.status = 'pending'
      AND (
        s2.created_at > s.created_at
        OR (s2.created_at = s.created_at AND s2.id > s.id)
      )
  );

-- 3. No máximo UMA pendente por (obra, atributo).
CREATE UNIQUE INDEX IF NOT EXISTS score_calibration_suggestions_pending_uniq
  ON score_calibration_suggestions (work_id, criterion_slug)
  WHERE status = 'pending';

COMMENT ON INDEX score_calibration_suggestions_pending_uniq IS
  'Garante no máximo uma sugestão pendente por (obra, atributo). Runs de audit substituem (superseded) a pendente anterior antes de inserir a nova.';
