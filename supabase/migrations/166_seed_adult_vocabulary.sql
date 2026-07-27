-- ============================================================
-- 166 — Semente do vocabulário 18+ óbvio (resolve síncrono, $0 de IA)
-- ============================================================
-- Agora que a criação NÃO descarta mais strings de fonte, rótulos como "Smut",
-- "Hentai", "Erotica", "Ecchi" chegam como tag. Para que o sinal 18+ dispare já na
-- 1ª avaliação (sem esperar o enricher assíncrono), pré-criamos esses rótulos no
-- grupo `content_indicator` com os flags certos, e mapeamos variantes por alias.
--
--   adult_indicator        → conta para works.adult_auto (flag is_adult).
--   adult_indicator_strong → subconjunto EXPLÍCITO (decide sozinho o is_adult).
--
-- O PISO da NOTA `adult_content` é wired em paralelo em adult-content-rules.ts
-- (EXPLICIT_LABEL_TAGS / ADULT_LABEL_TAGS) — os nomes aqui têm que casar com lá.
--
-- "Mature" fica DE FORA de propósito: é largo (cobre violência sem sexo). Deixamos
-- virar tag normal e a IA classifica o grupo/adult sob demanda.
-- ============================================================

-- content_indicator group id: 90edf1bb-a80e-459e-b421-ebca4e493128

INSERT INTO tags (slug, name, tag_group_id, adult_indicator, adult_indicator_strong, origin, reviewed_at)
VALUES
  ('smut',         'Smut',         '90edf1bb-a80e-459e-b421-ebca4e493128', true, true,  'manual', now()),
  ('hentai',       'Hentai',       '90edf1bb-a80e-459e-b421-ebca4e493128', true, true,  'manual', now()),
  ('pornographic', 'Pornographic', '90edf1bb-a80e-459e-b421-ebca4e493128', true, true,  'manual', now()),
  ('erotica',      'Erotica',      '90edf1bb-a80e-459e-b421-ebca4e493128', true, false, 'manual', now()),
  ('ecchi',        'Ecchi',        '90edf1bb-a80e-459e-b421-ebca4e493128', true, false, 'manual', now())
ON CONFLICT (slug) DO UPDATE SET
  tag_group_id           = EXCLUDED.tag_group_id,
  adult_indicator        = EXCLUDED.adult_indicator,
  adult_indicator_strong = EXCLUDED.adult_indicator_strong;

-- Variantes → canônica existente (resolve síncrono no resolveOrCreateTags).
INSERT INTO tag_alias (alias_slug, canonical_tag_id)
SELECT v.alias_slug, t.id
FROM (VALUES
  ('erotic',         'erotica'),   -- Erotic → Erotica
  ('adult-content',  'adult'),     -- Adult Content → Adult (já existe)
  ('nsfw',           'adult'),     -- NSFW → Adult
  ('r18',            'r19')        -- R18 (rating adulto) → R19 (já existe, strong)
) AS v(alias_slug, canonical_slug)
JOIN tags t ON t.slug = v.canonical_slug
ON CONFLICT (alias_slug) DO NOTHING;
