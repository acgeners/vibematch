-- ============================================================
-- 163 - Capas arquivadas ("lixeira" durável de work_covers)
--
-- Problema: apagar uma capa na edição só removia a linha de `work_covers`. Como
-- TRÊS caminhos diferentes reinserem capas a partir das fontes externas
-- (syncWorkCovers no save do form, syncExternalCovers no "Atualizar dados" e o
-- enriquecimento da Comix em server/comix/resolver.ts), a mesma capa ruim voltava
-- na próxima atualização — sem erro nenhum, só o trabalho refeito.
--
-- Por que TABELA SEPARADA e não uma coluna `is_archived` em `work_covers`:
-- `work_covers` é lida em ~25 lugares (cards, ranking, galeria da obra, prompts de
-- IA, scripts). Uma coluna exigiria `archived_at IS NULL` em TODOS eles, e o ponto
-- esquecido não daria erro — mostraria a capa arquivada de volta. Com tabela à
-- parte, quem lê capa continua lendo só capas vivas por construção; só os três
-- gravadores precisam consultar o arquivo.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_cover_archive (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  -- Sem CHECK de formato (ao contrário de work_covers.source): aqui a fonte é só
  -- rótulo pra você reconhecer a capa na lista "Arquivadas". Um CHECK rejeitaria o
  -- arquivamento de uma capa legada com source fora do padrão — ou seja, impediria
  -- justamente a limpeza que esta tabela existe pra permitir.
  source      TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_cover_archive_url_per_work UNIQUE (work_id, url)
);

CREATE INDEX IF NOT EXISTS idx_work_cover_archive_work
  ON work_cover_archive (work_id);

-- Catálogo: lido/escrito só pela service role, que ignora RLS. Ligada mesmo assim
-- para que o cliente anônimo não leia nada (mesma postura de work_covers).
ALTER TABLE work_cover_archive ENABLE ROW LEVEL SECURITY;
