-- ============================================================
-- 074 - user_settings (singleton) — Fase 1.5.1
-- ============================================================
-- Âncora pro `user_id` no estado single-user. Hoje o app não tem
-- camada de auth; toda calibração por-usuário (attribute_bias,
-- user_attribute_assessment) referencia este UUID fixo.
--
-- Quando multi-user chegar: a fonte do user_id passa a ser a sessão
-- de auth, sem migration — só troca quem lê `current_user_id`.
-- Mantém-se 1 linha (singleton); o app sempre lê a primeira.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_user_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garante a linha singleton (idempotente: só insere se vazia).
INSERT INTO user_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM user_settings);

COMMENT ON TABLE user_settings IS
  'Configuração singleton do app (single-user). current_user_id ancora a calibração por-usuário.';
COMMENT ON COLUMN user_settings.current_user_id IS
  'UUID fixo do usuário atual. Vira fonte da sessão de auth no futuro multi-user.';

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
