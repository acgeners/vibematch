-- ============================================================
-- 095 - work_manual_reviews: reviews escritas manualmente pelo usuário
-- ============================================================
-- Reviews que o usuário adiciona à mão para alimentar a avaliação IA,
-- separadas de `work_reviews` (que é um snapshot DESTRUTIVO do último
-- fetch externo — delete + insert). Manter manuais aqui garante que
-- elas SOBREVIVEM a cada nova busca/avaliação e são sempre reinjetadas
-- no prompt (não passam pelo cap/sampler das reviews externas).
--
-- Estratégia de atualização: snapshot por obra (delete + insert do
-- conjunto enviado pela UI), igual a work_reviews mas controlado só
-- pelo usuário.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_manual_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  user_rating NUMERIC(3,1),
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_manual_reviews_work_idx
  ON work_manual_reviews (work_id);

COMMENT ON TABLE work_manual_reviews IS
  'Reviews escritas manualmente pelo usuário para a avaliação IA. Sobrevivem ao snapshot de work_reviews e são sempre reinjetadas no prompt.';
COMMENT ON COLUMN work_manual_reviews.user_rating IS
  'Nota 0-10 opcional atribuída pelo usuário — espelha o sinal "nota do usuário" das reviews externas.';
COMMENT ON COLUMN work_manual_reviews.note IS
  'Contexto opcional do usuário (ex.: "li o mangá até o cap. 50"). Não vai pro prompt.';

ALTER TABLE work_manual_reviews ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
