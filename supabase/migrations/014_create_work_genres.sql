-- 1. Criar a tabela work_genres
CREATE TABLE work_genres (
  work_id  UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, genre_id)
);

-- Índice para buscas por gênero (ex: "todas as obras de ação")
CREATE INDEX work_genres_genre_id_idx ON work_genres (genre_id);

-- Habilitar RLS (consistente com migration 013)
ALTER TABLE work_genres ENABLE ROW LEVEL SECURITY;

-- 2. Popular work_genres a partir de work_tags
INSERT INTO work_genres (work_id, genre_id)
SELECT
  wt.work_id,
  g.id AS genre_id
FROM work_tags wt
JOIN tags t ON t.id = wt.tag_id
JOIN genres g ON g.tag_id = wt.tag_id
WHERE t.tag_group_id = '04eadb9a-5cc8-42ec-bbb3-1408fd7a1b7e'
ON CONFLICT (work_id, genre_id) DO NOTHING;
