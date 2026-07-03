-- ============================================================
-- 123 - Grupos de favoritos (work_lists)
-- ============================================================
-- Recortes nomeados de obras favoritas pra comparar em contextos
-- diferentes. Relação MUITOS-PRA-MUITOS: uma obra pode estar em vários
-- grupos ao mesmo tempo.
--
-- Semântica (decidida com o usuário):
--   • Grupo = SUBCONJUNTO dos favoritos. Adicionar uma obra a um grupo
--     também marca works.is_favorite = TRUE (garante que todo item de
--     grupo aparece no universo "Todos os favoritos"). Remover do grupo
--     NÃO desmarca is_favorite (pode estar em outros grupos / ser fav solto).
--   • A página /favorites vira o índice de grupos; /favorites?list=<id>
--     reusa a mesma tabela/filtros de hoje, escopada às obras do grupo.
--
-- updated_at é setado explicitamente nas actions (padrão do projeto, sem trigger).
-- ============================================================

CREATE TABLE IF NOT EXISTS work_lists (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  color          TEXT,                                  -- swatch escolhido (hsl/hex); nullable
  cover_work_ids UUID[] NOT NULL DEFAULT '{}',          -- até 3 obras p/ a capa; vazio => primeiras da ordenação
  comments       JSONB NOT NULL DEFAULT '[]'::jsonb,    -- log de comentários do grupo: [{id, text, created_at}] (além da descrição)
  position       INTEGER NOT NULL DEFAULT 0,            -- ordenação manual do índice (reorder = fase 2)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_list_items (
  list_id   UUID NOT NULL REFERENCES work_lists(id) ON DELETE CASCADE,
  work_id   UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,                 -- ordem dentro do grupo (reorder = fase 2)
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, work_id)
);

-- Listagem do índice (mais recentes primeiro por padrão) + lookup reverso
-- "em quais grupos essa obra está" (popover "Adicionar a grupo").
CREATE INDEX IF NOT EXISTS idx_work_lists_position ON work_lists (position, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_list_items_list_id ON work_list_items (list_id);
CREATE INDEX IF NOT EXISTS idx_work_list_items_work_id ON work_list_items (work_id);

COMMENT ON TABLE work_lists IS
  'Grupos de favoritos (recortes nomeados). cover_work_ids = até 3 obras escolhidas p/ a capa; vazio => primeiras pela ordenação padrão.';
COMMENT ON TABLE work_list_items IS
  'Associação obra<->grupo (M-pra-N). Adicionar um item também marca works.is_favorite=TRUE na action; remover NÃO desmarca.';

ALTER TABLE work_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_list_items ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
