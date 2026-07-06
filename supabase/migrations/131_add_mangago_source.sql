-- ============================================================
-- 131 - Registra o Mangago (www.mangago.me) como fonte externa.
--
-- Mangago é fonte de METADADOS (título, sinopse, capa, gêneros,
-- títulos alternativos, status) — não expõe rating/reviews num
-- formato confiável, então não alimenta platform_ratings nem
-- work_reviews neste primeiro momento.
--
-- Depois de aplicar esta migration, rode `npm run sync-constants`
-- (precisa de SUPABASE_SERVICE_ROLE_KEY) para regenerar
-- ExternalSourceId / PLATFORMS / PLATFORM_LABELS a partir do DB.
-- Idempotente (mesmo padrão do seed em 021).
-- ============================================================

INSERT INTO source (slug, name, "order")
SELECT 'mangago', 'Mangago', 10
WHERE NOT EXISTS (SELECT 1 FROM source WHERE slug = 'mangago');
