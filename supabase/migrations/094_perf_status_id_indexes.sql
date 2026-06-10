-- ============================================================
-- 094 - Índices nas FKs de status de works (perf)
-- ============================================================
-- As queries de listagem (getRanking, getWorks, dashboard) filtram
-- por publication_status_id / personal_status_id. As colunas TEXT
-- legadas (publication_status / personal_status) e seus índices foram
-- dropadas na migração de _id; ficou sem índice nas colunas FK novas.
--
-- Nota de impacto: no volume atual (~660 obras) o ganho é marginal —
-- um seq scan de 660 linhas é sub-milissegundo. Estes índices são
-- principalmente future-proofing pro catálogo crescer; o gargalo real
-- de hoje é o tamanho do payload das queries, não estes filtros.
--
-- work_tags/work_genres já têm work_id coberto pela PK; work_covers/
-- work_synopses e calculated_scores(work_id) já têm índice próprio.

CREATE INDEX IF NOT EXISTS idx_works_publication_status_id
  ON works (publication_status_id);

CREATE INDEX IF NOT EXISTS idx_works_personal_status_id
  ON works (personal_status_id);
