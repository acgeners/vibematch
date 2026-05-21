-- ============================================================
-- 050 - calculated_scores.personal_fit: alinhamento determinístico
--       entre o TasteProfile atual e cada obra (0–1).
-- ============================================================
-- Computado em recalculateAll() consumindo o TasteProfile vigente.
-- Quando o perfil é stub ou inexistente, fica NULL e o ranking não
-- pode ordenar por essa coluna (fallback transparente pro final_score).
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS personal_fit NUMERIC(4,3);

COMMENT ON COLUMN calculated_scores.personal_fit IS
  'Alinhamento determinístico (0–1) entre o TasteProfile atual e a obra. NULL quando perfil é stub.';
