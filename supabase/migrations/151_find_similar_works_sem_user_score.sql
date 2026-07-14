-- 151_find_similar_works_sem_user_score.sql
-- FASE D — a RPC de similares para de devolver a nota do DONO.
--
-- `find_similar_works` (mig 054) devolve `w.user_score` no RETURNS TABLE. Isso é duas coisas
-- erradas ao mesmo tempo:
--
-- 1. **É a nota do DONO.** O card "Similares" da página da obra mostrava, para qualquer usuário,
--    a nota que ELE deu nas obras parecidas. O TS já ignora esse campo desde a Fase D (lê do
--    espelho de quem olha), então removê-lo daqui é fechar a porta, não mudar o comportamento.
--
-- 2. 🔴 **Ela é uma bomba-relógio pro `DROP COLUMN`.** O corpo da função é uma STRING
--    (`AS $function$ … $function$`), e o Postgres **não registra dependência de coluna** nesse
--    formato. Ou seja: `alter table works drop column user_score` iria passar SEM ERRO, e a
--    função só quebraria na PRÓXIMA vez que alguém abrisse a página de uma obra —
--    "column w.user_score does not exist", em produção, longe do drop que causou.
--    O drop não avisa. Esta migration é o aviso.
--
-- O resto da função é idêntico (mesma busca por embedding, mesmo limite, mesma ordenação).
-- Só o `user_score` sai — do RETURNS TABLE e do SELECT.
--
-- ⚠️ `create or replace` NÃO consegue mudar o RETURNS TABLE ("cannot change return type of
-- existing function"). Tem que ser DROP + CREATE. Entre um e outro a função não existe; o
-- caller (`getSimilarWorks`) já degrada pra lista vazia se a RPC falhar, e a API roda o
-- arquivo inteiro numa transação — então a janela não é observável.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/151_find_similar_works_sem_user_score.sql

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
  WITH target AS (
    SELECT embedding FROM work_embeddings WHERE work_id = target_work_id
  ),
  ranked AS (
    SELECT
      we.work_id,
      1 - (we.embedding <=> (SELECT embedding FROM target)) AS similarity
    FROM work_embeddings we
    WHERE we.work_id != target_work_id
      AND EXISTS (SELECT 1 FROM target)
    ORDER BY we.embedding <=> (SELECT embedding FROM target)
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
  WHERE w.is_archived = false
  ORDER BY r.similarity DESC;
$function$;

comment on function public.find_similar_works(uuid, integer) is
  'Top-K similares por embedding. NÃO devolve user_score: a nota é PESSOAL (mora em user_work_state) e a que estava aqui era a do dono, exibida para qualquer um. Também tirava o chão do DROP COLUMN: corpo em string não registra dependência de coluna, então o drop passaria e a função quebraria depois, em runtime.';
