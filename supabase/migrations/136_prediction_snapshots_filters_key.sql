-- ============================================================
-- 136 — prediction_snapshots.filters_key (filtros LEGÍVEIS da run de ranking)
-- ============================================================
-- ADITIVA e NÃO-DESTRUTIVA. Aditivo às migrations 105 e 135.
--
-- Motivação (validação da instrumentação, 2026-07-09): a run de ranking já é
-- identificada por `ranking_snapshot_id` (UUIDv5 determinístico de
-- usuário+dia+fórmula+FILTROS+mood) e por `dedup_key`, mas os FILTROS entram só
-- como HASH — não dá pra LER quais filtros produziram um snapshot. Esta coluna
-- guarda o descritor legível (JSON.stringify(filters)) pra debug e segmentação
-- (ex.: comparar rankings só-Completed vs all).
--
-- NÃO participa do dedup nem do id: é puramente descritiva. Registros antigos
-- ficam com NULL. Imutável como o resto do snapshot.
-- ============================================================

alter table public.prediction_snapshots
  add column if not exists filters_key text;

comment on column public.prediction_snapshots.filters_key is
  'Descritor legível dos filtros aplicados na run de ranking (JSON.stringify(filters)). NULL=registros antigos. Usado para debug/segmentação.';
