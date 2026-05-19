-- Adiciona flag de "favorito" em works.
-- Independente de personal_status/is_archived: permite destacar obras
-- transversalmente (ex.: marcar uma obra "Completed" como favorita).

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN works.is_favorite IS
  'Marca a obra como favorita do usuário. Independente de personal_status/is_archived.';

-- Índice parcial: apenas linhas favoritadas. Otimiza filtro
-- "somente favoritos" e ordenação "favoritos primeiro" sem custo significativo.
CREATE INDEX IF NOT EXISTS works_is_favorite_idx
  ON works (is_favorite)
  WHERE is_favorite = TRUE;
