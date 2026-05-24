-- ============================================================
-- 060 - last_read_at em works
-- ============================================================
-- Data da última vez que o usuário leu a obra. Auto-preenchida
-- quando o status sai de "To read" ou quando chapters_read aumenta;
-- pode ser editada manualmente no form de status.
-- Limpa para NULL quando o status volta para "To read".
-- ============================================================

ALTER TABLE works ADD COLUMN IF NOT EXISTS last_read_at DATE;

COMMENT ON COLUMN works.last_read_at IS
  'Data da última leitura (manual ou auto-set quando status sai de "To read" ou chapters_read aumenta).';

CREATE INDEX IF NOT EXISTS works_last_read_at_idx
  ON works (last_read_at DESC NULLS LAST);
