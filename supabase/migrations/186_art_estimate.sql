-- Estimativa de arte: o dado.
--
-- A nota de arte (`pilot_taste_scores.like_art_score`) é previsível a partir de sinal que já
-- está no banco — tags, eixo "arte" do digest e léxico nas menções das reviews. Medido em
-- 2026-08-12 (`scripts/diag-arte-desempate.ts`, OOF honesto sobre 200 rótulos):
--
--   Spearman 0,531 · AUC "arte ≥ 9" 0,765
--   desempate entre obras com a MESMA Nota Prevista exibida: direção certa em 67,7% (n=541)
--   fundo 20% do estimador concentra 2,6× a arte fraca
--
-- 🔴 Ela NÃO entra na Nota Prevista. Plugada como feature do Ridge dá ΔMAE −0,005, com IC95%
-- excluindo até o +0,007 que a teoria previa: `like_art_score` é 1/7 do `user_score`, então
-- entra no rótulo com a variância dividida por 49 (3,2% do total). Serve pra ORDENAR e
-- FILTRAR por escolha explícita do leitor — nunca como feature nem como desempate automático
-- (rumo ao gosto ela acerta 55,8%, quase moeda, e reordenaria 94,9% do catálogo).
--
-- Duas colunas porque são duas metades com custos MUITO diferentes:
--
--   works.art_signal          — o sinal CRU, caro de extrair (lê digest + texto de review).
--                               Recomputado só quando reviews/digest mudam.
--   calculated_scores.art_*   — a estimativa, barata de aplicar. Sai no recalc, que já tem o
--                               catálogo inteiro (o percentil precisa dele) e já grava
--                               `tag_overlap_net` e `personal_fit_percentile` do mesmo jeito.
--
-- Sem essa separação o recalc passaria a ler `review_digest` de todas as obras — e o digest é
-- parte do que torna a tabela `works` cara. O recalc já é o maior consumidor de egress.

alter table public.works
  add column if not exists art_signal jsonb;

comment on column public.works.art_signal is
  'Sinal cru de arte extraído de reviews + digest (lib/arte/signal.ts). Chaves: v, digestPositive, digestNegative, reviewCount, artMentions, lexPositive, lexNegative. NULL = nunca extraído; v menor que ART_SIGNAL_VERSION = extraído por uma régua antiga e precisa ser refeito. As tags NÃO entram aqui de propósito: elas já chegam ao recalc pelo select de work_tags, e guardá-las obrigaria a reler o digest a cada mudança de tag.';

alter table public.calculated_scores
  add column if not exists art_estimate numeric,
  add column if not exists art_percentile numeric;

comment on column public.calculated_scores.art_estimate is
  'Estimativa 0-10 da nota de arte. Para obra COM rótulo, é out-of-fold (o rótulo dela não treinou o modelo que a estima). NULL quando não há sinal nenhum ou o modelo está abaixo do piso de treino — NULL é um terceiro estado e nunca deve virar a média: a escala é comprimida a ~0,49x a do rótulo, então o valor não é comparável em PONTOS com uma nota de critério.';

comment on column public.calculated_scores.art_percentile is
  'Posição da estimativa no catálogo (0-1, midrank). É esta a grandeza que a UI filtra e ordena — nunca art_estimate em pontos. Medido: um corte "arte >= 8" em pontos devolve 55% do catálogo onde a taxa real é 75%.';
