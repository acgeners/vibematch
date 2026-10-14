-- 219 — Proveniência HUMANA por campo de tag: `tags.human_decisions`.
--
-- 🔴 NÃO APLICADA (2026-10-13). Aditiva e sem backfill. ORDEM DE DEPLOY: 219 → código. O código que a
-- acompanha LÊ e GRAVA a coluna (fila "Tags novas", ações de revisão, `enrichNewTags`); publicado antes
-- dela, essas leituras falham com "column does not exist".
--
-- POR QUE: o schema só sabia dizer o que a AUTOMAÇÃO fez com a tag inteira (`enrichment_status`, 210).
-- Uma decisão humana sobre UM campo não deixava rastro, ou deixava o mesmo rastro da IA:
--   · `setTagAdult` e `changeTagGroup` não gravavam nada além do valor;
--   · `setTagScoreTier` gravava `adult_score_tier_reviewed_at`, a mesma marca que o enriquecedor grava;
--   · subgrupo: `tag_subgroup_assignment` vira `applied` tanto para a IA quanto para a colocação humana
--     depois de aplicada, e remover o subgrupo (decidir "nenhum") apagava a linha;
--   · `reviewed_at` é a confirmação da tag INTEIRA na fila, sem dizer quais campos.
-- Resultado: uma tag cuja classificação automática falhou e que um humano corrigiu continuava
-- indistinguível de uma que ninguém tocou — e não havia como ela sair da fila sem reprocessar (pago).
--
-- O QUE A COLUNA É: PROVENIÊNCIA, não uma 2ª fonte de verdade. O VALOR de cada campo continua nas
-- colunas/tabelas canônicas (`tag_group_id`, `adult_indicator`/`_strong`, `adult_score_tier`,
-- `tag_subgroup_id`/`tag_subgroup_assignment`). Aqui fica só QUEM decidiu e QUANDO:
--   { "group":            { "at": "<timestamptz>", "by": "<auth.users.id>" },
--     "adult":            { ... },   -- sinal 18+ (adult_indicator/_strong)
--     "adult_score_tier": { ... },   -- piso da nota adult_content
--     "subgroup":         { ... } }  -- inclusive a decisão "nenhum subgrupo"
-- Chave ausente = nenhum humano decidiu aquele campo. `by` só vai quando a sessão o fornece.
--
-- O QUE NÃO FAZ: não toca nenhuma linha existente (default `{}`; adicionar coluna com default
-- constante é só metadado no Postgres ≥ 11 — sem reescrever a tabela); não muda `enrichment_status`;
-- não muda as 4 tags de 2026-10-08.
--
-- IDEMPOTENTE. ROLLBACK: `alter table public.tags drop constraint if exists tags_human_decisions_shape;
-- alter table public.tags drop column if exists human_decisions;` (o código que lê a coluna tem de
-- voltar antes).

set lock_timeout = '5s';

alter table public.tags add column if not exists human_decisions jsonb not null default '{}'::jsonb;

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'tags_human_decisions_shape') then
    -- Objeto, e só as quatro chaves conhecidas: um typo no código vira erro na escrita, não uma chave
    -- que nenhuma leitura enxerga.
    alter table public.tags add constraint tags_human_decisions_shape check (
      jsonb_typeof(human_decisions) = 'object'
      and (human_decisions - array['group', 'adult', 'adult_score_tier', 'subgroup']) = '{}'::jsonb
    );
  end if;
end
$ck$;

comment on column public.tags.human_decisions is
  'Proveniência HUMANA por campo (migration 219): {group|adult|adult_score_tier|subgroup: {at, by?}}. '
  'Só quem/quando — o valor fica nas colunas canônicas. Chave ausente = nenhum humano decidiu o campo. '
  'Independe de enrichment_status (que descreve só a automação).';
