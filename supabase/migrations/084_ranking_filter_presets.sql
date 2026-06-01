-- ============================================================
-- 084 - ranking_filter_presets — conjuntos de filtros salvos
-- ============================================================
-- Permite o usuário salvar um conjunto de filtros do /ranking
-- (ou /favorites) e reaplicar depois. O estado de filtro vive
-- inteiro na query string da URL, então um preset é só
-- (nome + query). Escopo por base_path mantém /ranking e
-- /favorites separados.
--
-- Ancorado em user_id (current_user_id do user_settings, padrão
-- single-user). Quando multi-user chegar, a fonte do user_id vira
-- a sessão de auth — a tabela já está pronta.
-- ============================================================

CREATE TABLE IF NOT EXISTS ranking_filter_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  base_path   TEXT NOT NULL,
  name        TEXT NOT NULL,
  query       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um nome único por usuário + página (suporta upsert/overwrite).
CREATE UNIQUE INDEX IF NOT EXISTS ranking_filter_presets_user_path_name_key
  ON ranking_filter_presets (user_id, base_path, name);

-- Listagem ordenada por mais recente.
CREATE INDEX IF NOT EXISTS ranking_filter_presets_user_path_idx
  ON ranking_filter_presets (user_id, base_path, created_at DESC);

COMMENT ON TABLE ranking_filter_presets IS
  'Conjuntos de filtros salvos do ranking/favorites. Um preset = nome + query string da URL, por user_id e base_path.';

ALTER TABLE ranking_filter_presets ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
