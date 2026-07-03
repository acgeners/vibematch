-- 119 — flag por-obra "já passou pela inferência de tags por IA".
-- Setada sempre que o fluxo de inferência RODA numa obra (mesmo achando 0 tags),
-- pra distinguir "nunca rodou" de "rodou e não achou nada". NULL = nunca rodou.
-- Escrita em lib/tags/auto-infer.ts (criação + botão) e scripts/infer-tags.ts (backfill).

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS tags_inferred_at TIMESTAMPTZ;

COMMENT ON COLUMN works.tags_inferred_at IS
  'Última vez que a inferência de tags por IA rodou nesta obra (mesmo com 0 tags novas). NULL = nunca passou pela inferência.';
