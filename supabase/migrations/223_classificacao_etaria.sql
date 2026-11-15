-- 223 — `work_age_rating`: classificação etária da obra (e da versão normal das mixed).
--
-- ✅ APLICADA NA NUVEM em 2026-11-15 (psql como `postgres`, ensaio com rollback antes e conferência antes do commit).
--
-- ORDEM DE DEPLOY: 223 → código → carga (`scripts/carregar-classificacao-etaria.ts`). O código novo
-- LÊ a tabela no cálculo do 18+ (`planAdultAuto`) e na página da obra; publicado antes dela, o
-- recálculo do gate falha (e loga) em vez de decidir sem a classificação.
--
-- O QUE É: três faixas na régua da classificação indicativa brasileira — 14 ("Livre a 14"), 16, 18 —
-- vindas da classificação OFICIAL dos produtos (Naver Webtoon/Series, Kakao Webtoon, RIDI, Bomtoon,
-- KMAS, editoras em inglês), arredondada para cima. Auditoria de 14–15/11/2026:
-- `Auditoria/classificacao-etaria-2026-11-14/` (fora do git).
--
-- REGRAS (donos em TS):
--   · versão com conteúdo explícito é 18, sempre — `ageRatingFor` (`lib/age-rating/age-rating.ts`);
--   · faixa 18 na linha `obra` LIGA o gate 18+ (`adult_reason = 'official_rating'`) —
--     `decideAdultAuto` (`lib/tags/adult-classify.ts`). O override humano continua vencendo;
--   · linha com `conflito` está na fila "Conflitos de classificação" de /curation/settings.
--
-- `versao`: 'obra' = a obra inteira (não-mixed); 'normal' = a versão normal de uma mixed (a adulta é
-- 18 por definição e não tem linha). Sem linha = sem classificação.
--
-- Aditiva, sem backfill (a carga é por script, com ensaio). IDEMPOTENTE. ROLLBACK:
--   update public.works set adult_auto = false, adult_reason = null where adult_reason = 'official_rating';
--   drop table if exists public.work_age_rating;

set lock_timeout = '5s';

create table if not exists public.work_age_rating (
  work_id uuid not null references public.works(id) on delete cascade,
  versao text not null check (versao in ('obra', 'normal')),
  faixa smallint check (faixa in (14, 16, 18)),
  conflito text,
  evidencia jsonb not null default '{}'::jsonb,
  decidido_por text not null check (decidido_por in ('auditoria', 'curadoria')),
  atualizado_em timestamptz not null default now(),
  primary key (work_id, versao),
  constraint work_age_rating_conflito_nao_vazio check (conflito is null or btrim(conflito) <> '')
);

comment on table public.work_age_rating is
  'Classificação etária (mig 223): faixa 14/16/18 por obra (versao=obra) ou pela versão normal de uma mixed '
  '(versao=normal). Faixa 18 em versao=obra liga works.adult_auto com adult_reason=official_rating. '
  'Sem linha = sem classificação. Regra de exibição: lib/age-rating/age-rating.ts.';
comment on column public.work_age_rating.faixa is
  '14 = livre a 14 · 16 · 18. NULL = sem faixa definida (conflito aberto, ou curadoria decidiu deixar sem).';
comment on column public.work_age_rating.conflito is
  'Motivo do conflito entre a faixa oficial e os sinais da obra. Não-nulo = na fila de revisão da curadoria.';
comment on column public.work_age_rating.evidencia is
  'Produtos e rótulos que sustentam a faixa (plataforma, id, rótulo, url), registros do KMAS e sinais adultos.';

comment on column public.works.adult_reason is
  'Proveniência do adult_auto: tag_explicit | official_rating (classificação etária 18, mig 223) | ai_review | '
  'ai_review_uncertain | ai_review_clean | tag_soft_score (legado).';

-- Catálogo: só a service role lê/escreve (RLS ligada, nenhuma policy) — como as demais tabelas de catálogo.
alter table public.work_age_rating enable row level security;
