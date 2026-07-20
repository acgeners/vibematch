-- ============================================================
-- 162 — Alias de slug: previous_slugs pra redirecionar URLs antigas
-- ============================================================
-- O slug de uma obra é derivado do título (titleToSlug). Ao renomear, o slug antigo
-- deixa de resolver e QUALQUER URL que ainda aponte pra ele dá 404 — o botão Voltar
-- (o save renomeado empurra uma entrada nova no histórico e deixa a antiga viva),
-- bookmarks, uma segunda aba, links internos antigos.
--
-- previous_slugs guarda os slugs de títulos ANTERIORES (preenchido no rename por
-- updateWork). getWorkBySlug procura aqui quando o slug atual não resolve, e a página
-- redireciona pro slug canônico em vez de 404. Índice GIN pro `@>` (contains) ser O(1).
--
-- Aditivo e reversível: coluna nova com default '{}', nenhum dado existente é tocado.

alter table works
  add column if not exists previous_slugs text[] not null default '{}';

comment on column works.previous_slugs is
  'Slugs de títulos anteriores desta obra. Preenchido no rename (updateWork); lido por getWorkBySlug pra redirecionar URLs antigas ao slug atual em vez de 404.';

create index if not exists works_previous_slugs_gin
  on works using gin (previous_slugs);
