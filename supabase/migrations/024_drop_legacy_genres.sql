-- ============================================================
-- 024 - Consolidação de gêneros: drop works.genres (text[]),
-- drop genres.tag_id, delete tags do tag_group "genre" e o próprio
-- tag_group. work_genres + genres viram a única fonte de verdade.
--
-- Pré-requisitos (já feitos):
--   - work_genres populado para todas as obras com gêneros válidos
--   - código não lê/escreve mais works.genres (Fase 4.2 no TypeScript)
--   - código não escreve mais em work_tags para tag_group=genre
-- ============================================================

-- ------------------------------------------------------------
-- 1) Backfill final defensivo: garante que work_genres tem as
-- linhas correspondentes a works.genres (text[]) caso ainda exista
-- alguma divergência. Idempotente.
-- ------------------------------------------------------------
INSERT INTO work_genres (work_id, genre_id)
SELECT w.id, g.id
FROM works w
CROSS JOIN LATERAL unnest(w.genres) AS genre_name
JOIN genres g ON LOWER(g.name) = LOWER(genre_name)
ON CONFLICT (work_id, genre_id) DO NOTHING;

-- ------------------------------------------------------------
-- 2) Captura o id do tag_group "genre" para limpeza.
-- Se não existir mais (ex.: já dropado), continua silenciosamente.
-- ------------------------------------------------------------
DO $$
DECLARE
  genre_group_id UUID;
BEGIN
  SELECT id INTO genre_group_id FROM tag_group WHERE slug = 'genre';

  IF genre_group_id IS NOT NULL THEN
    -- Apaga relações work_tags que apontam para tags-de-gênero.
    DELETE FROM work_tags
    WHERE tag_id IN (SELECT id FROM tags WHERE tag_group_id = genre_group_id);

    -- Apaga a FK genres.tag_id (vai virar dangling com o DELETE de tags).
    BEGIN
      ALTER TABLE genres DROP COLUMN IF EXISTS tag_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Coluna genres.tag_id já removida ou inexistente.';
    END;

    -- Apaga as tags do tag_group "genre".
    DELETE FROM tags WHERE tag_group_id = genre_group_id;

    -- Apaga o tag_group "genre".
    DELETE FROM tag_group WHERE id = genre_group_id;

    RAISE NOTICE 'tag_group "genre" e %s tags relacionadas removidos.', genre_group_id;
  ELSE
    RAISE NOTICE 'tag_group "genre" não encontrado — nada a fazer.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3) Drop da coluna legada works.genres.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_works_genres;
ALTER TABLE works DROP COLUMN IF EXISTS genres;
