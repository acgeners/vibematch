-- ============================================================
-- 071 - calculated_scores.personal_fit_percentile: percentil do
--       personal_fit dentro da biblioteca do user (0–100).
-- ============================================================
-- O `personal_fit` cru fica em escala 0–1 ancorada matematicamente nos
-- componentes (tag_alignment, criterion_alignment, profile_consistency).
-- Na prática, mesmo as obras MELHOR alinhadas raramente passam de 0.55 —
-- comunicar "55% de fit" lê como mediano quando na verdade é o topo.
--
-- Persistir o PERCENTIL absoluto na biblioteca permite a UI mostrar
-- "Top 5%" ou "Top 50%", que é mais honesto e acionável que o valor cru.
-- Computado durante recalculateAll a partir da distribuição completa.
--
-- NULL pra obras sem personal_fit (perfil stub ou obra sem tags/critérios
-- pra comparar). NULL pra obras com personal_fit válido mas computado
-- antes da migration — vão receber valor no próximo recálculo.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS personal_fit_percentile NUMERIC(5,2);

COMMENT ON COLUMN calculated_scores.personal_fit_percentile IS
  'Percentil (0–100) do personal_fit dentro da biblioteca. 95 = está nos 5% mais alinhados. NULL quando personal_fit é NULL ou pré-migration 071.';
