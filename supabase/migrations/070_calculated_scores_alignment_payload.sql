-- ============================================================
-- 070 - calculated_scores.alignment_payload: payload enriquecido do
--       consultor (sub-fase 2.3.A — Smart Shortlist enriquecido).
-- ============================================================
-- O tool `submit_ranking` foi estendido (prompt v2) com campos opcionais:
--   - confidence (0–1)         — quanto o modelo confia no alignment_score
--   - risks (string[])         — razões pra NÃO ler (mesmo com match alto)
--   - similar_loved (id[])     — obras amadas na biblioteca que esta lembra
--   - similar_avoided (id[])   — obras evitadas similares (alerta de risco)
--   - review_quotes (string[]) — quotes citáveis das reviews
--   - mood_fit (0–1 | null)    — fit com mood/contexto quando enviado
--
-- Armazenar como JSONB único permite evoluir a tool sem migrações futuras —
-- novos campos viram chaves opcionais. UI lê o que estiver lá.
--
-- alignment_score, alignment_justification, alignment_run_id, alignment_at
-- continuam sendo colunas dedicadas (queries de ranking dependem deles).
-- alignment_payload é o "metadados ricos" pra UI expandida.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS alignment_payload JSONB;

COMMENT ON COLUMN calculated_scores.alignment_payload IS
  'Payload enriquecido do consultor (prompt v2+). Campos: confidence (0–1), risks (string[]), similar_loved (work_id[]), similar_avoided (work_id[]), review_quotes (string[]), mood_fit (0–1 | null). Todos opcionais — runs antigas (prompt v1) ficam NULL.';
