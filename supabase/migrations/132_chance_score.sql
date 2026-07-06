-- ============================================================
-- 132 — chance_score (Força 1 da Bússola de Leitura)
-- ============================================================
-- "Chance de gostar" (0–100): probabilidade calibrada de o usuário gostar da
-- obra, = P(user_score ≥ 8). Logística L2 + calibração Platt sobre features de
-- fit (tags declaradas + category_scores + personal_fit + Interesse-na-obra).
-- Ver lib/calculations/chance.ts, lib/ml/logistic.ts e PLANO-BUSSOLA-3-FORCAS.md.
--
-- Validado (2026-07-06, n=206): AUC 0.74, calibração honesta em 20–80%, robusto
-- a leakage (CLEAN sem perfil = AUC 0.71). Computado no recalc junto do
-- expected_score. Aditiva: NULL até o próximo recalc preencher.
-- ============================================================

alter table calculated_scores
  add column if not exists chance_score    numeric(5,2),
  add column if not exists chance_is_stub  boolean;

comment on column calculated_scores.chance_score is
  'Chance de gostar 0–100 (Força 1 da Bússola) — logística L2 calibrada (Platt) sobre fit. NULL até recalc / quando stub.';
comment on column calculated_scores.chance_is_stub is
  'true quando o modelo de Chance caiu no fallback (< 20 rótulos) — chance_score fica NULL.';
