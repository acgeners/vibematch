-- 221 — `works.latest_chapter_url`: onde o "Continuar lendo" da /reading leva.
--
-- ✅ APLICADA NA NUVEM em 2026-11-12 (psql como `postgres`, em transação com conferência antes do
-- commit). Aditiva e sem backfill. ORDEM DE DEPLOY: 221 → código. O código que
-- a acompanha LÊ a coluna ao abrir a /reading e GRAVA na checagem de capítulos; publicado antes dela,
-- as duas degradam sem o link (a leitura repete o select sem a coluna; a gravação, o update) — o
-- botão volta a ser o de antes, mas as datas não se perdem.
--
-- POR QUE (medido em 2026-11-11): o link era sempre a página da Comix quando a obra tinha um hid
-- dela, mesmo com a página devolvendo 404. O lote de capítulos achou 12 hids da Comix mortos; em 9
-- deles o capítulo veio do Mangago, e mesmo assim o botão abria a página que não existe mais. Sem
-- hid, o botão não tinha link nenhum até alguém clicar em "Verificar atualizações".
--
-- O QUE É: a URL escolhida pela ÚLTIMA checagem que achou capítulo (`pickReadUrl`): a Comix quando
-- ela respondeu (a leitura preferida), senão a fonte que achou o capítulo. Nula = nunca checada com
-- sucesso; a tela cai no hid da Comix, como antes. Dado de CATÁLOGO (onde a obra pode ser lida), não
-- de pessoa.
--
-- IDEMPOTENTE. ROLLBACK: `alter table public.works drop column if exists latest_chapter_url;`
-- (perde só os links gravados; a tela volta ao hid da Comix).

alter table public.works add column if not exists latest_chapter_url text;

comment on column public.works.latest_chapter_url is
  'Link do "Continuar lendo": a página da Comix quando ela respondeu na última checagem de capítulos, senão a da fonte que achou o capítulo (Mangago). Nula = nunca checada com sucesso.';
