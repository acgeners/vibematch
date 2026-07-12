-- ============================================================
-- 135 — prediction_snapshots.rank_position (posição EXIBIDA no ranking)
-- ============================================================
-- ADITIVA e NÃO-DESTRUTIVA. Aditivo à migration 105.
--
-- Motivação (AUDIT_REPORT-2026-07-08, P1 — instrumentação prospectiva):
-- o snapshot já guarda `tier` e `predicted_score`, mas NÃO a posição real que a
-- obra ocupava na lista exibida. A ordem exibida pode divergir de
-- `order by predicted_score` (desempate por tag_overlap_net, sort alternativo,
-- mood preset), então guardar o rank real permite medir NDCG/regret/precision
-- contra o que o usuário DE FATO viu — não contra uma ordem reconstruída.
--
-- `rank_position` é 1-based (1 = topo). NULL para snapshots antigos e para
-- contextos sem posição (ex.: work_opened avulso). Imutável, como o resto do
-- snapshot (só a resolução escreve depois).
-- ============================================================

alter table prediction_snapshots
  add column if not exists rank_position integer;

alter table prediction_snapshots
  drop constraint if exists prediction_snapshots_rank_position_positive;
alter table prediction_snapshots
  add constraint prediction_snapshots_rank_position_positive
  check (rank_position is null or rank_position > 0);

comment on column prediction_snapshots.rank_position is
  'Posição 1-based da obra na lista EXIBIDA no momento do snapshot (1 = topo). NULL = sem posição/antigo. Base de NDCG/regret/precision fiéis à ordem vista. Migration 135.';
