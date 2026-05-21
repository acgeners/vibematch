-- ============================================================
-- 053 - work_embeddings: representação vetorial das obras pra
--       similaridade semântica (Passo 4) e kNN preditor (Passo 5).
-- ============================================================
-- Vetor gerado por OpenAI text-embedding-3-small (1536 dimensões).
-- Cacheado por obra; só re-embeda quando `input_hash` mudar
-- (sinopse, tags ou critérios alterados).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS work_embeddings (
  work_id UUID PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW pra busca aproximada por cosine — escala melhor que ivfflat
-- e não precisa de ANALYZE prévio. Parâmetros default (m=16, ef_construction=64)
-- são adequados pra bases pequenas-médias (≤10k vetores).
CREATE INDEX IF NOT EXISTS work_embeddings_hnsw
  ON work_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS work_embeddings_input_hash
  ON work_embeddings (input_hash);

COMMENT ON TABLE work_embeddings IS
  'Embeddings vetoriais das obras (OpenAI text-embedding-3-small). Cacheado por input_hash.';
COMMENT ON COLUMN work_embeddings.input_hash IS
  'SHA-256 do input canonical (title + synopsis + tags + critérios). Re-embeda quando muda.';
COMMENT ON COLUMN work_embeddings.model_name IS
  'Modelo usado (ex: text-embedding-3-small). Permite migração de modelo no futuro sem perder dados antigos.';

ALTER TABLE work_embeddings ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
