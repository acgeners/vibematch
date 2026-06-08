-- ============================================================
-- 092 - user_settings: saldo manual da conta Anthropic (snapshot)
-- ============================================================
-- A Anthropic não expõe o saldo da conta por API. O usuário informa
-- manualmente o saldo lido no console e o app mostra o restante
-- diminuir conforme usa a IA (página /ai-usage + chip da sidebar).
--
-- Modelo "snapshot que rebaseia": guardamos o VALOR informado e o
-- INSTANTE em que foi informado. O restante é calculado on-the-fly:
--   restante = anthropic_balance_usd − Σ ai_api_calls.cost_total_usd
--              onde created_at >= anthropic_balance_set_at
-- Reinformar o valor real do console zera o desvio acumulado (o custo
-- aqui é estimativa de lib/ai/pricing.ts, e o saldo do console drena
-- também com uso fora deste app).
--
-- Single-user: mora na linha singleton de user_settings, mesma
-- estratégia de user_plan (078) e do perfil (090). NULL = nunca
-- informado. Idempotente.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS anthropic_balance_usd    NUMERIC,
  ADD COLUMN IF NOT EXISTS anthropic_balance_set_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.anthropic_balance_usd IS
  'Saldo da conta Anthropic informado manualmente (USD). NULL = nunca informado. Snapshot: combine com anthropic_balance_set_at.';
COMMENT ON COLUMN user_settings.anthropic_balance_set_at IS
  'Instante em que o saldo foi informado. O restante subtrai o custo das chamadas (ai_api_calls) a partir desta data.';
