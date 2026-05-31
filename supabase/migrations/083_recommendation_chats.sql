-- ============================================================
-- 083 - Recommendation chats (chat conversacional de recomendação)
-- ============================================================
-- Persiste as conversas do chat de recomendação por IA (plano Pago).
-- O chat é uma camada fina sobre o ranker: conversa em multi-turn e,
-- quando entende o mood, dispara `runRecommendationAction` (que cria a
-- recommendation_run e o upsert de alignment_score normalmente).
--
-- 1 linha = 1 conversa. As mensagens vivem num array JSONB (como
-- recommendation_runs.results), incluindo um snapshot compacto da
-- recomendação gerada em cada turno do assistente (auto-contido pra
-- render sem re-fetch da run).
-- ============================================================

CREATE TABLE IF NOT EXISTS recommendation_chats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD-N (igual recommendation_runs)
  title             TEXT,                   -- derivado da 1ª mensagem do usuário
  messages          JSONB NOT NULL DEFAULT '[]'::jsonb,
  taste_profile_id  UUID REFERENCES taste_profile(id) ON DELETE SET NULL,
  model_name        TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listagem do histórico (mais recentes primeiro).
CREATE INDEX IF NOT EXISTS idx_recommendation_chats_updated
  ON recommendation_chats (updated_at DESC);

COMMENT ON TABLE recommendation_chats IS
  'Conversas do chat de recomendação por IA (Pago). 1 linha = 1 conversa; mensagens em JSONB.';
COMMENT ON COLUMN recommendation_chats.messages IS
  'Array de {role, content, recommendation?, created_at}. recommendation guarda runSlug + snapshot compacto das obras (work_id, title, coverUrl, alignment_score, justification, top_match_factors).';

ALTER TABLE recommendation_chats ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
