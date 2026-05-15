-- ============================================================
-- 038 — Marcar fontes rejeitadas em work_external_ids
-- ============================================================
-- A UI de revalidação de fontes precisa permitir que o usuário marque
-- "nenhum" pra uma source (ex.: MyAnimeList não tem essa obra, ou tinha
-- um match errado que foi removido). Pra evitar re-busca recorrente,
-- persistimos a rejeição explícita.
--
-- Estados possíveis após esta migration:
--   - Sem linha               → fonte ainda não foi avaliada (refresh tenta buscar)
--   - external_id + !rejected → match ativo, usado
--   - external_id + rejected  → teve match mas user descartou (não usa)
--   - null id + rejected      → user marcou que não há match válido
--
-- external_id vira NULLABLE pra suportar o último caso.
-- ============================================================

ALTER TABLE work_external_ids
  ADD COLUMN IF NOT EXISTS is_rejected BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE work_external_ids
  ALTER COLUMN external_id DROP NOT NULL;

COMMENT ON COLUMN work_external_ids.is_rejected IS
  'True quando o usuário marcou essa fonte como não-match válido. Próximas buscas/reviews ignoram.';
COMMENT ON COLUMN work_external_ids.external_id IS
  'ID externo da obra na fonte. NULL quando o usuário marcou que não há match válido (is_rejected=true).';
