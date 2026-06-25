-- 117 - Proveniência de tags em work_tags (para tags inferidas por IA da sinopse)
--
-- Aditivo e não-destrutivo. Espelha category_scores.source. Linhas existentes
-- ficam com source = NULL (= legado / humano / importado de fonte externa).
-- Tags inferidas pelo script scripts/infer-tags.ts gravam source = 'ai_inferred'
-- + confidence (0..1). Sem CHECK rígido: os upserts atuais (syncWorkTags /
-- syncWorkTagsPartial) inserem sem 'source', então um CHECK NOT NULL quebraria.
--
-- Reversão das tags inferidas:
--   DELETE FROM work_tags WHERE source = 'ai_inferred';

ALTER TABLE work_tags
  ADD COLUMN IF NOT EXISTS source     TEXT,
  ADD COLUMN IF NOT EXISTS confidence REAL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN work_tags.source IS
  'Origem da associação: NULL = legado/humano/importado; ''ai_inferred'' = inferida da sinopse por IA (scripts/infer-tags.ts).';
COMMENT ON COLUMN work_tags.confidence IS
  'Confiança 0..1 quando source = ''ai_inferred'' (alta = 0.9, média = 0.6). NULL caso contrário.';

-- Índice parcial leve para auditoria/rollback das tags inferidas.
CREATE INDEX IF NOT EXISTS work_tags_ai_inferred_idx
  ON work_tags (work_id)
  WHERE source = 'ai_inferred';
