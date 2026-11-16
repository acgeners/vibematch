-- 225_find_similar_works_centralizado.sql
-- "Obras parecidas" (aba Recomendações da obra + Deep Dive) no espaço CENTRALIZADO,
-- o mesmo de /descobrir (migs 187 e 189), e obra arquivada filtrada ANTES do corte.
--
-- 🔴 POR QUE: a mig 187 achou e corrigiu o "hubness" só em /descobrir. Aqui a busca seguia no
-- espaço cru, e o defeito é o mesmo: o vizinho do centro da nuvem é o genérico, não o parecido.
-- Medido na nuvem em 2026-11-16 (1.085 obras ativas, top-8 de cada uma):
--
--                               cru (até a 224)   centralizado (esta)
--   obra que mais aparece           145 listas        50 listas
--   obras em 40 listas ou mais          42                 8
--   obras que nunca aparecem          23%               4,3%
--
-- Os "ímãs" do cru são as obras com MAIS TAGS (105 tags em média, contra 29 nas que nunca
-- aparecem): a lista longa de tags puxa o vetor para o centro do catálogo.
--
-- Efeito colateral: a similaridade passa a ter 0 = acaso (no cru, duas obras quaisquer davam
-- ~0,69). Entre as 8 mais parecidas de uma obra o normal fica entre 0,29 e 0,37 — quem pinta o
-- número na tela (`similar-works-card.tsx`) recalibrou as faixas junto.
--
-- ⚠️ A arquivada saía DEPOIS do LIMIT: com uma arquivada entre as K mais próximas, a lista
-- vinha com K−1 (medido: 3 obras com 7 em vez de 8). Agora o filtro vem antes do corte.
--
-- ⚠️ A média inclui os vetores de obras arquivadas, como na 187/189 — as três funções têm de
-- medir no MESMO espaço, senão "parecida" teria duas réguas no app.
--
-- Mesmo RETURNS TABLE da 151 (nenhum consumidor muda). DROP + CREATE pelo mesmo motivo de lá.
--
-- Aplicar: psql como postgres numa transação (ver o cabeçalho da 203); a Management API está
-- só-leitura para este token.

drop function if exists public.find_similar_works(uuid, integer);

create function public.find_similar_works(target_work_id uuid, match_limit integer default 10)
returns table(
  id uuid,
  title text,
  similarity double precision,
  expected_score numeric,
  personal_fit numeric,
  cover_url text,
  synopsis text
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
  target AS (
    SELECT c.v FROM centered c WHERE c.work_id = target_work_id
  ),
  ranked AS (
    SELECT c.work_id, 1 - (c.v <=> t.v) AS similarity
    FROM centered c
    CROSS JOIN target t
    JOIN works w ON w.id = c.work_id
    WHERE c.work_id <> target_work_id
      AND w.is_archived = false
    ORDER BY c.v <=> t.v, c.work_id
    LIMIT match_limit
  )
  SELECT
    w.id,
    w.title,
    r.similarity,
    cs.expected_score,
    cs.personal_fit,
    (
      SELECT wc.url FROM work_covers wc
      WHERE wc.work_id = w.id
      ORDER BY wc.is_primary DESC NULLS LAST, wc.position ASC NULLS LAST
      LIMIT 1
    ) AS cover_url,
    (
      SELECT ws.text FROM work_synopses ws
      WHERE ws.work_id = w.id
      ORDER BY ws.is_primary DESC NULLS LAST, ws.position ASC NULLS LAST
      LIMIT 1
    ) AS synopsis
  FROM ranked r
  JOIN works w ON w.id = r.work_id
  LEFT JOIN calculated_scores cs ON cs.work_id = w.id
  ORDER BY r.similarity DESC, w.id;
$function$;

comment on function public.find_similar_works(uuid, integer) is
  'Top-K similares por embedding, no espaço CENTRALIZADO (embedding - média do catálogo), o mesmo de find_similar_to_seeds e pairwise_similarity: no cru as obras com muitas tags viravam ímãs (uma em 145 listas). Similaridade 0 = acaso. Arquivada sai ANTES do corte. NÃO devolve user_score: a nota é pessoal (user_work_state).';
