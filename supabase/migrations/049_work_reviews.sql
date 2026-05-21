-- ============================================================
-- 049 - work_reviews: persistência das reviews externas
-- ============================================================
-- Reviews coletadas de fontes externas (MangaUpdates, AniList,
-- MyAnimeList, Kitsu, AnimePlanet) durante:
--  - "Buscar dados" no fluxo de criação/atualização
--  - Avaliação IA (já que reviews alimentam o Claude)
--
-- Estratégia de atualização: snapshot — quando re-buscar,
-- delete + insert pra evitar reviews antigas misturadas com novas.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_title TEXT,
  text TEXT NOT NULL,
  text_length INTEGER,
  user_rating NUMERIC(3,1),
  match_score NUMERIC(3,2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_reviews_work_idx
  ON work_reviews (work_id);

CREATE INDEX IF NOT EXISTS work_reviews_work_source_idx
  ON work_reviews (work_id, source);

COMMENT ON TABLE work_reviews IS
  'Snapshot das reviews externas coletadas durante busca de dados ou avaliação IA.';
COMMENT ON COLUMN work_reviews.fetched_at IS
  'Timestamp do fetch externo — todas as reviews de um snapshot têm o mesmo valor.';
COMMENT ON COLUMN work_reviews.match_score IS
  'Similaridade entre o título da obra e o sourceTitle (0–1).';

ALTER TABLE work_reviews ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
