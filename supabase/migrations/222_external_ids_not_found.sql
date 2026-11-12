-- 222 — `work_external_ids.not_found_external_id` + `not_found_at`: o vínculo cujo código dá 404.
--
-- ✅ APLICADA NA NUVEM em 2026-11-12 (psql como `postgres`, em transação com conferência antes do
-- commit). Aditiva e sem backfill. ORDEM DE DEPLOY: 222 → código. O código que
-- a acompanha LÊ as colunas (painel da Comix, aba Fontes) e GRAVA (checagem de capítulos, lote de
-- reviews, `scripts/conferir-links-comix.ts`); publicado antes dela, essas leituras falham.
--
-- POR QUE (medido em 2026-11-11/12): o painel da Comix só reconhecia "sem código" e "não existe na
-- Comix". Obra COM código que devolve 404 contava como coberta — "Com hid Comix 1074 · 100%" e
-- "Nenhuma obra pendente" com 12 códigos mortos achados pelo lote de capítulos. O 404 era detectado
-- num lugar só (`fetchComixHtmlOutcome`) e virava `null`/`[]` logo acima: só sobrava no log.
--
-- REGRA: morto = `not_found_external_id = external_id`. Guardar O CÓDIGO que falhou, e não uma flag,
-- é o que torna a marca velha inofensiva sozinha: colar um código novo muda `external_id` e os dois
-- deixam de bater; marcar ausente zera `external_id`. Nenhum escritor de `work_external_ids` precisa
-- limpar nada — e as upserts existentes mandam só as próprias colunas, então não apagam a marca.
-- Indisponível (Cloudflare, timeout) NUNCA grava: não prova nada. Quem grava e quem lê:
-- `lib/external/link-status.ts` e `classifySourceLink` (`lib/external/source-link-state.ts`).
--
-- Serve a qualquer fonte; hoje só a Comix grava.
--
-- IDEMPOTENTE. ROLLBACK:
--   alter table public.work_external_ids drop column if exists not_found_at;
--   alter table public.work_external_ids drop column if exists not_found_external_id;

alter table public.work_external_ids add column if not exists not_found_external_id text;
alter table public.work_external_ids add column if not exists not_found_at timestamptz;

comment on column public.work_external_ids.not_found_external_id is
  'O código desta fonte que devolveu 404. O vínculo está morto quando é IGUAL a external_id; com código novo (ou ausência declarada) a marca deixa de valer sozinha.';
comment on column public.work_external_ids.not_found_at is
  'Quando o 404 de not_found_external_id foi visto por último.';
