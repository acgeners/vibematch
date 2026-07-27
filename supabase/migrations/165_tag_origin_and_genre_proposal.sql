-- ============================================================
-- 165 — Proveniência/revisão em tags + fila de gêneros propostos
-- ============================================================
-- Contexto: a criação de obra parava de descartar strings de gênero/tag que não
-- batiam no catálogo (external.ts). Agora elas viram tag (create-on-demand) e as
-- de campo-gênero também viram CANDIDATO A GÊNERO. Para isso precisamos de:
--
--   tags.origin       → de onde a tag veio ('manual' | 'external' | 'ai_inferred').
--                       Alimenta a aba "Tags novas" (origin='external' ∧ não revisada).
--   tags.reviewed_at  → quando o admin confirmou/curou a tag nova. NULL = pendente.
--   genre_proposal    → strings do CAMPO GÊNERO que não são um dos gêneros do catálogo.
--                       Já viram tag na obra (nada se perde); aprovar promove a gênero.
--
-- Tabelas de catálogo NÃO têm política de RLS: são lidas/escritas pela service role,
-- que ignora RLS. O cliente anônimo não lê nada (intencional).
-- ============================================================

-- 1) Proveniência + estado de revisão nas tags.
--    Default 'manual' → as 1.505 tags existentes NÃO entram na fila de revisão.
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL;

-- índice parcial: a aba "Tags novas" só varre externas não revisadas.
CREATE INDEX IF NOT EXISTS tags_pending_review_idx
  ON tags (created_at)
  WHERE origin = 'external' AND reviewed_at IS NULL;

-- 2) Fila de gêneros propostos (promoção tag → gênero, com aprovação humana).
CREATE TABLE IF NOT EXISTS genre_proposal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name        TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  occurrences     INTEGER NOT NULL DEFAULT 1,
  sample_work_ids UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genre_proposal_status_idx ON genre_proposal (status);

ALTER TABLE genre_proposal ENABLE ROW LEVEL SECURITY;
-- Sem política: catálogo é servido pela service role (ignora RLS); anon não lê.
