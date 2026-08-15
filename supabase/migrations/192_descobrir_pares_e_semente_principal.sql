-- 192_descobrir_pares_e_semente_principal.sql
-- "Mais como estas" (/descobrir): dizer QUEM está destoando, e deixar uma semente pesar mais.
--
-- Duas mudanças, ambas somente-leitura:
--   seeds_diagnostics  →  seed_pair_similarity : devolve os PARES em vez da média deles
--   find_similar_to_seeds                      : ganha `primary_seed_id` (peso 2×)
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔴 POR QUE A MÉDIA SAI DO SQL — a coesão passa a ter UM dono
--
-- `seeds_diagnostics` calculava `avg(1 - (a.v <=> b.v))` e jogava os pares fora. Isso
-- bastava para acender o alarme e não bastava para consertá-lo: a tela dizia "estas obras
-- não têm um eixo em comum" sem dizer QUAL delas está fora, e o conselho ("troque uma") não
-- tinha destinatário.
--
-- Com os pares na mão, o TS deriva TRÊS leituras do mesmo dado: a média (a coesão de hoje),
-- a média sem cada semente (leave-one-out → quem destoa) e a média só dos pares que tocam a
-- principal (a coesão ancorada). Deixar o `avg()` aqui e recalcular lá seria a família de
-- erro que este projeto persegue: dois critérios para o mesmo fato, discordando no dia em
-- que um dos dois mudar.
--
-- Custo: com o teto de 5 sementes são no máximo **10 linhas**. A varredura é idêntica.
--
-- ⚠️ `n_requested`/`n_with_embedding` SUMIRAM daqui, e não é esquecimento: `loadSeedInfo` já
-- consulta `work_embeddings` para marcar `hasEmbedding` em cada chip. Eram duas fontes para
-- o mesmo fato — e a de cá era a que ninguém via.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔴 POR QUE A PRINCIPAL É UM PESO, E NÃO UMA BUSCA SEPARADA
--
-- `sim_pos` sempre foi `avg(1 - (c.v <=> s.v))` sobre as sementes — média SIMPLES, cada uma
-- valendo 1/n. A principal troca isso por média PONDERADA. Com peso 1 em todas, a expressão
-- é aritmeticamente idêntica à anterior (conferido no teste de contrato), então quem não usa
-- a estrela não vê diferença nenhuma no resultado.
--
-- ⚠️ O peso é 2, não configurável, e o número mora AQUI. Cada regime de pesos desloca a
-- distribuição de `sim_pos`, e os cortes que dependem dela (0,15/0,28 da coesão, o λ=0,8 da
-- diversificação) foram medidos com pesos iguais. "2× ou nada" é UM regime novo a remedir;
-- um slider contínuo seriam infinitos, nenhum medido.
--
-- 🔴 `sim_pos_flat` é devolvida SEMPRE — é a mesma conta com todos os pesos em 1.
-- Sem ela, responder "essa estrela está mudando alguma coisa?" custaria uma segunda
-- varredura do catálogo (140 KB crus, medidos). Com ela, custa uma coluna de 8 bytes por
-- linha e o TS compara as duas ordenações de graça. Quando não há principal as duas colunas
-- são o mesmo número, de propósito: o consumidor não precisa saber se há estrela ou não.
--
-- ⚠️ `nearest_seed_id` NÃO é ponderada. Ela responde "qual semente puxou esta obra", que é
-- um fato sobre proximidade — dobrar o peso de uma semente não a torna mais próxima.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/192_descobrir_pares_e_semente_principal.sql

-- ───────────────────────────────────────────────────────────────────────────────────────
-- 1. Os pares entre as sementes

drop function if exists public.seeds_diagnostics(uuid[]);

create function public.seed_pair_similarity(seed_ids uuid[])
returns table(
  a uuid,
  b uuid,
  sim double precision
)
language sql
stable
as $function$
  WITH mu AS MATERIALIZED (
    SELECT avg(embedding) AS m FROM work_embeddings
  ),
  centered AS MATERIALIZED (
    SELECT we.work_id, (we.embedding - mu.m)::vector(1536) AS v
    FROM work_embeddings we CROSS JOIN mu
    WHERE mu.m IS NOT NULL AND we.work_id = ANY(seed_ids)
  )
  -- `x.work_id < y.work_id` dá o triângulo superior: cada par UMA vez, sem a diagonal.
  -- Espelhar é trabalho do consumidor, como já é em `pairwise_similarity` (mig 189).
  SELECT x.work_id AS a, y.work_id AS b, (1 - (x.v <=> y.v)) AS sim
  FROM centered x JOIN centered y ON x.work_id < y.work_id;
$function$;

comment on function public.seed_pair_similarity(uuid[]) is
  'Similaridade entre cada PAR de sementes, em espaço centralizado (0 = acaso). Substitui seeds_diagnostics, que devolvia só a média: com os pares o TS deriva a coesão, o leave-one-out (qual semente destoa) e a coesão ancorada numa principal — três leituras do mesmo dado, sem duas fontes discordarem. Máx. 10 linhas (teto de 5 sementes). Vazio com menos de 2 sementes com vetor.';

-- ───────────────────────────────────────────────────────────────────────────────────────
-- 2. A busca, agora com semente principal

drop function if exists public.find_similar_to_seeds(uuid[], uuid[], integer);
drop function if exists public.find_similar_to_seeds(uuid[], uuid[], integer, boolean);
drop function if exists public.find_similar_to_seeds(uuid[], uuid[], integer, boolean, uuid);

create function public.find_similar_to_seeds(
  seed_ids uuid[],
  anti_ids uuid[] default '{}'::uuid[],
  match_limit integer default 5000,
  include_adult boolean default true,
  primary_seed_id uuid default null
)
returns table(
  id uuid,
  sim_pos double precision,
  sim_pos_flat double precision,
  sim_neg double precision,
  nearest_seed_id uuid
)
language sql
stable
as $function$
  WITH mu AS MATERIALIZED (
    SELECT avg(embedding) AS m FROM work_embeddings
  ),
  centered AS MATERIALIZED (
    SELECT we.work_id, (we.embedding - mu.m)::vector(1536) AS v
    FROM work_embeddings we CROSS JOIN mu
    WHERE mu.m IS NOT NULL
  ),
  seeds AS MATERIALIZED (
    SELECT
      c.work_id,
      c.v,
      -- O 2.0 desta linha é o regime medido; ver o bloco no topo antes de mexer.
      CASE WHEN c.work_id = primary_seed_id THEN 2.0::double precision
           ELSE 1.0::double precision END AS w
    FROM centered c WHERE c.work_id = ANY(seed_ids)
  ),
  antis AS MATERIALIZED (
    SELECT c.v FROM centered c WHERE c.work_id = ANY(coalesce(anti_ids, '{}'::uuid[]))
  ),
  scored AS (
    SELECT
      c.work_id,
      (SELECT sum(s.w * (1 - (c.v <=> s.v))) / nullif(sum(s.w), 0) FROM seeds s) AS sim_pos,
      (SELECT avg(1 - (c.v <=> s.v)) FROM seeds s)                               AS sim_pos_flat,
      -- Sem anti-sementes o termo é 0, não NULL: ele entra numa SUBTRAÇÃO do lado TS, e
      -- NULL propagaria apagando o score inteiro da obra.
      coalesce((SELECT avg(1 - (c.v <=> a.v)) FROM antis a), 0) AS sim_neg,
      (SELECT s.work_id FROM seeds s ORDER BY c.v <=> s.v LIMIT 1) AS nearest_seed_id
    FROM centered c
    WHERE NOT (c.work_id = ANY(seed_ids))
      AND NOT (c.work_id = ANY(coalesce(anti_ids, '{}'::uuid[])))
  )
  SELECT sc.work_id AS id, sc.sim_pos, sc.sim_pos_flat, sc.sim_neg, sc.nearest_seed_id
  FROM scored sc
  JOIN works w ON w.id = sc.work_id
  WHERE w.is_archived = false
    AND (include_adult OR coalesce(w.is_adult, false) = false)
    AND sc.sim_pos IS NOT NULL          -- nenhuma semente tinha embedding
  ORDER BY sc.sim_pos DESC
  LIMIT match_limit;
$function$;

comment on function public.find_similar_to_seeds(uuid[], uuid[], integer, boolean, uuid) is
  'Similaridade de cada obra a um CONJUNTO de sementes, em espaço CENTRALIZADO (embedding - média do catálogo). A centralização não é refinamento: sem ela o resultado degenera nas obras mais centrais do acervo (medido: 1 obra em 30 de 40 sementes aleatórias). `primary_seed_id` dá peso 2x a uma semente; `sim_pos_flat` é a MESMA conta com pesos iguais, devolvida sempre para que "a estrela mudou algo?" não custe uma 2a varredura. Devolve o catálogo inteiro de propósito — quem pondera parecença contra alinhamento é o TS, e cortar um top-K aqui enviesaria o pool e o percentil. NÃO devolve score pessoal: isso é do overlay de user_calculated_scores.';
