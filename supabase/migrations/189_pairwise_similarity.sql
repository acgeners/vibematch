-- 189_pairwise_similarity.sql
-- Similaridade PAR A PAR entre obras — a matriz que a diversificação de `/descobrir` exige.
--
-- A `find_similar_to_seeds` (mig 187) responde "quanto cada obra se parece com as SEMENTES".
-- Isso ordena a lista, mas não diz nada sobre as obras se parecerem ENTRE SI — e é essa a
-- pergunta da variedade: duas obras podem ter a mesma similaridade às sementes e serem
-- quase idênticas uma à outra, ou completamente distintas.
--
-- 🔴 POR QUE ISSO PRECISA EXISTIR, medido em 2026-08-13 (12 conjuntos-semente, 9.360 pares):
--
-- Pelo agregado a lista parecia saudável — redundância do top-24 em **0,106** contra
-- **0,092** do próprio pool de candidatos, só 15% acima. Por OBRA, não: **2,4 de 10** obras
-- do top-10 tinham ao menos uma quase-duplicata (similaridade > 0,35), e a posição mediana
-- delas era a **4ª**. A média escondia porque diluía os poucos pares muito altos (até 0,686)
-- numa maioria de pares baixos.
--
-- ⚠️ MESMO espaço centralizado da mig 187, e pela mesma razão: no cru, todo par do catálogo
-- fica em 0,69–0,89 e nada discrimina. Aqui isso é ainda mais crítico do que lá, porque o
-- número vai ser comparado contra um LIMIAR (`NEAR_DUPLICATE_SIM`), não só ordenado.
--
-- ⚠️ `AS MATERIALIZED` pelo mesmo motivo da 187: dentro de `language sql` com parâmetro, a
-- CTE é inlineada e a subtração dos vetores é refeita a cada referência (lá isso custou
-- 438 ms contra 23 ms).
--
-- Escala: a página pede isto para o POOL exibível (~50 obras ⇒ ~1.200 pares), nunca para o
-- catálogo — 984 obras dariam 483 mil pares.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/189_pairwise_similarity.sql

drop function if exists public.pairwise_similarity(uuid[]);

create function public.pairwise_similarity(work_ids uuid[])
returns table(a uuid, b uuid, sim double precision)
language sql
stable
as $function$
  WITH mu AS MATERIALIZED (
    SELECT avg(embedding) AS m FROM work_embeddings
  ),
  centered AS MATERIALIZED (
    SELECT we.work_id, (we.embedding - mu.m)::vector(1536) AS v
    FROM work_embeddings we CROSS JOIN mu
    WHERE mu.m IS NOT NULL AND we.work_id = ANY(work_ids)
  )
  -- Só o triângulo superior: sim(a,b) = sim(b,a) e a diagonal não interessa. Metade dos
  -- bytes, e quem consome espelha em memória.
  SELECT c1.work_id AS a, c2.work_id AS b, 1 - (c1.v <=> c2.v) AS sim
  FROM centered c1
  JOIN centered c2 ON c1.work_id < c2.work_id;
$function$;

comment on function public.pairwise_similarity(uuid[]) is
  'Similaridade entre CADA PAR das obras pedidas, no espaço centralizado (mesmo da mig 187). Alimenta a diversificação de /descobrir: sem ela dá para ordenar a lista, mas não para saber que a 4ª e a 15ª são a mesma obra com outro nome. Só o triângulo superior. Pedir para o catálogo inteiro seriam 483 mil pares — use no pool exibível.';
