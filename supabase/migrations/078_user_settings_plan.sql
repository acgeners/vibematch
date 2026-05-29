-- ============================================================
-- 078 - user_settings.user_plan — Bloco 2 (free vs pago)
-- ============================================================
-- Flag de plano do usuário. Gate central pras features de IA sob demanda
-- (Smart Shortlist, Deep Dive, mood) e pra previsão rica (L0+ qualidade,
-- TasteProfile LLM). A fonte de verdade do que é free/pago vive em
-- lib/plans/capabilities.ts; esta coluna só diz em qual plano o user está.
--
-- Default 'free' (novo usuário começa grátis). O singleton atual (dev) é
-- setado pra 'paid' pra não perder acesso às features já existentes.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS user_plan TEXT NOT NULL DEFAULT 'free'
    CHECK (user_plan IN ('free', 'paid'));

-- Dev (singleton existente) mantém acesso total.
UPDATE user_settings SET user_plan = 'paid';

COMMENT ON COLUMN user_settings.user_plan IS
  'Plano do usuário: free | paid. Gate das features de IA sob demanda e da previsão rica (ver lib/plans/capabilities.ts).';
