-- 187_find_similar_to_seeds.sql
-- "Mais como estas" (/descobrir) — similaridade a um CONJUNTO de obras-semente.
--
-- Duas funções, ambas somente-leitura:
--   find_similar_to_seeds(seed_ids, anti_ids, match_limit) → sim de cada obra às sementes
--   seeds_diagnostics(seed_ids)                            → coesão + quantas têm embedding
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔴 POR QUE OS VETORES SÃO CENTRALIZADOS (subtrair a média global do catálogo)
--
-- A implementação óbvia — média dos embeddings das sementes, vizinhos mais próximos — está
-- QUEBRADA, e falha produzindo resultado plausível. Medido no clone local em 2026-08-13,
-- 40 sementes aleatórias de 3 obras, top-10 cada (400 vagas):
--
--   cru           →  112 obras distintas · pior atrator em 26 das 40 sementes
--   CENTRALIZADO  →  312 obras distintas · pior atrator em  4 das 40
--
-- Numa das rodadas uma única obra apareceu em **30 das 40** sementes. Os atratores são
-- exatamente as obras mais CENTRAIS do catálogo (todas no p99 de similaridade média contra
-- o acervo) — é o problema de "hubness" em alta dimensão: o centróide de qualquer conjunto
-- cai perto do centro da nuvem, e o vizinho do centro é o genérico, não o parecido.
--
-- Conferido também na leitura: para *Villains Are Destined to Die*, o modo cru trazia 3
-- atratores globais entre 6 vizinhos; o centralizado revelou o eixo real da obra (vilã
-- dentro de um jogo/otome).
--
-- Efeito colateral bem-vindo: no espaço centralizado a similaridade média entre duas obras
-- quaisquer é **0 por construção**, então o número passa a ser lido como "quanto acima do
-- acaso" — é isso que torna a coesão de `seeds_diagnostics` interpretável sem calibração.
--
-- ⚠️ A média global é calculada NA HORA (~1 ms sobre 984 linhas, medido). Materializá-la numa
-- tabela criaria uma 2ª cópia que envelhece em silêncio a cada `refreshEmbeddings` — a mesma
-- armadilha de `LOW_BALANCE_USD` e `STRONG_TAG_WEIGHT`, só que num número que ninguém olha.
--
-- ⚠️ O índice HNSW (`work_embeddings_hnsw`) NÃO é usado aqui, e não é esquecimento: ele
-- indexa `embedding`, não `embedding - média`. O seq scan das 984 obras com sementes
-- positivas e negativas roda em **~23 ms** — não vale um índice funcional que precisaria ser
-- reconstruído sempre que a média mudasse.
--
-- 🔴 `AS MATERIALIZED` nas CTEs é OBRIGATÓRIO — sem ele a função fica 20× mais lenta, e nada
-- acusa. Medido em 2026-08-13, mesma função, mesmas sementes: **438 ms sem, ~23 ms com**.
--
-- A causa é a fronteira da função, não a query: solta, a MESMA consulta roda em 29 ms. Dentro
-- de `language sql` os parâmetros (`seed_ids`) tornam o plano genérico, o Postgres 12+ inlina
-- CTE por padrão, e `centered` é referenciada QUATRO vezes (seeds, antis, scored e os
-- subselects) — então a subtração de 984 vetores de 1536 dimensões é refeita a cada
-- referência. É a pior forma de regressão de performance: some ao testar o SQL na mão e só
-- aparece através da RPC.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔴 POR QUE ELA DEVOLVE O CATÁLOGO INTEIRO EM VEZ DE UM TOP-K
--
-- Quem ordena o resultado final é o TypeScript, porque o peso (parecença × alinhamento) é
-- escolhido pelo usuário e o `personal_fit` de QUEM OLHA não está aqui — vem de
-- `user_calculated_scores` via `getScoresReader()`.
--
-- Se esta função cortasse um top-K por similaridade, ela decidiria o pool antes de o peso
-- existir: na ponta "a minha cara" (w→0) a lista deveria ser praticamente o ranking do
-- perfil, e sairia filtrada por um critério que o usuário mandou ignorar. Pior, o PERCENTIL
-- de similaridade passaria a ser calculado sobre um pool já cortado — enviesado por
-- construção.
--
-- O custo de devolver tudo, MEDIDO contra a nuvem em 2026-08-13 (974 linhas, 3 sementes):
-- **140 KB crus · 32,5 KB comprimidos** (o gateway responde `content-encoding: gzip`),
-- em 145–184 ms. Os metadados pesados (título, capa, sinopse) são buscados depois, só para
-- os que aparecem na tela. `match_limit` fica como GUARDA de tamanho, com default folgado —
-- não como recorte de relevância.
--
-- ⚠️ Esta linha já disse "≈ 60 KB", que era ESTIMATIVA — o real é 2,3× maior. Cada troca de
-- semente ou de filtro paga esse payload, então é ele que dá o teto de quantas buscas cabem
-- na quota; ver a seção de egress do CLAUDE.md.
--
-- ⚠️ Diferenças deliberadas em relação a `find_similar_works` (mig 054/151), as duas por
-- defeito que já custou caro:
--   1. NÃO devolve `expected_score` / `personal_fit`. Aqueles campos vêm de
--      `calculated_scores`, que é do DONO — foi o que a 151 teve de arrancar quando a nota
--      dele vazava no card de similares. Score pessoal aqui é responsabilidade do overlay.
--   2. Filtra `is_archived` ANTES do LIMIT. Na 151 o filtro vem depois, então pedir 8
--      pode devolver menos de 8, em silêncio.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/187_find_similar_to_seeds.sql

-- ⚠️ `include_adult` é parâmetro daqui, e não filtro do lado TS, porque o PERCENTIL de
-- similaridade é calculado sobre o conjunto devolvido. Filtrar 18+ depois compararia cada
-- obra contra um universo que não é o exibido — a barra diria "97% de parecença" medindo
-- contra obras que a pessoa nunca veria. Filtro que muda o universo tem que vir antes.
-- (O filtro "só não lidas" NÃO cabe aqui: status é per-user, e esta função roda em service
-- role sem saber quem pergunta.)
drop function if exists public.find_similar_to_seeds(uuid[], uuid[], integer);
drop function if exists public.find_similar_to_seeds(uuid[], uuid[], integer, boolean);

create function public.find_similar_to_seeds(
  seed_ids uuid[],
  anti_ids uuid[] default '{}'::uuid[],
  match_limit integer default 5000,
  include_adult boolean default true
)
returns table(
  id uuid,
  sim_pos double precision,
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
    SELECT c.work_id, c.v FROM centered c WHERE c.work_id = ANY(seed_ids)
  ),
  antis AS MATERIALIZED (
    SELECT c.v FROM centered c WHERE c.work_id = ANY(coalesce(anti_ids, '{}'::uuid[]))
  ),
  scored AS (
    SELECT
      c.work_id,
      (SELECT avg(1 - (c.v <=> s.v)) FROM seeds s) AS sim_pos,
      -- Sem anti-sementes o termo é 0, não NULL: ele entra numa SUBTRAÇÃO do lado TS, e
      -- NULL propagaria apagando o score inteiro da obra.
      coalesce((SELECT avg(1 - (c.v <=> a.v)) FROM antis a), 0) AS sim_neg,
      (SELECT s.work_id FROM seeds s ORDER BY c.v <=> s.v LIMIT 1) AS nearest_seed_id
    FROM centered c
    WHERE NOT (c.work_id = ANY(seed_ids))
      AND NOT (c.work_id = ANY(coalesce(anti_ids, '{}'::uuid[])))
  )
  SELECT sc.work_id AS id, sc.sim_pos, sc.sim_neg, sc.nearest_seed_id
  FROM scored sc
  JOIN works w ON w.id = sc.work_id
  WHERE w.is_archived = false
    AND (include_adult OR coalesce(w.is_adult, false) = false)
    AND sc.sim_pos IS NOT NULL          -- nenhuma semente tinha embedding
  ORDER BY sc.sim_pos DESC
  LIMIT match_limit;
$function$;

comment on function public.find_similar_to_seeds(uuid[], uuid[], integer, boolean) is
  'Similaridade de cada obra a um CONJUNTO de sementes, em espaço CENTRALIZADO (embedding - média do catálogo). A centralização não é refinamento: sem ela o resultado degenera nas obras mais centrais do acervo (medido: 1 obra em 30 de 40 sementes aleatórias). Devolve o catálogo inteiro de propósito — quem pondera parecença contra alinhamento é o TS, e cortar um top-K aqui enviesaria o pool e o percentil. NÃO devolve score pessoal: isso é do overlay de user_calculated_scores.';

-- ───────────────────────────────────────────────────────────────────────────────────────
-- Diagnóstico das sementes: responde "dá pra confiar nesta busca?" ANTES de mostrar lista.
--
-- `cohesion` = similaridade média entre os PARES de sementes, no mesmo espaço centralizado.
-- Como lá o acaso é 0, o número é auto-explicativo. Medido em 2026-08-13:
--
--   sementes coerentes (vizinhas)   cohesion 0,329  →  top-10 com sim 0,266
--   sementes aleatórias             cohesion 0,001  →  top-10 com sim 0,169  (−36%)
--
-- Ou seja: sementes sem eixo comum não dão erro, dão uma lista pior — e é o tipo de falha
-- que o usuário atribui à ferramenta. Com o número na mão dá pra avisar antes.
--
-- `n_with_embedding` existe porque semente sem vetor é ignorada em silêncio pela função
-- acima (hoje 984 de 988 obras têm embedding). Sem este contador, escolher 3 obras e ter 1
-- descartada seria invisível.
drop function if exists public.seeds_diagnostics(uuid[]);

create function public.seeds_diagnostics(seed_ids uuid[])
returns table(
  n_requested integer,
  n_with_embedding integer,
  cohesion double precision
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
  SELECT
    coalesce(array_length(seed_ids, 1), 0)::integer AS n_requested,
    (SELECT count(*) FROM centered)::integer        AS n_with_embedding,
    -- NULL com menos de 2 sementes com vetor: não existe "coesão" de um ponto só, e
    -- devolver 0 ali seria indistinguível de "sem eixo comum", que é o alarme.
    (SELECT avg(1 - (a.v <=> b.v)) FROM centered a JOIN centered b ON a.work_id < b.work_id)
      AS cohesion;
$function$;

comment on function public.seeds_diagnostics(uuid[]) is
  'Coesão das sementes (sim média entre pares, espaço centralizado — 0 = acaso) e quantas têm embedding. Serve para avisar ANTES de listar: sementes sem eixo comum devolvem lista 36% mais fraca sem dar erro nenhum. cohesion NULL = menos de 2 sementes com vetor.';
