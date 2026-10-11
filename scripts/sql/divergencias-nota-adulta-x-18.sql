-- Divergências entre a nota `adult_content` e o gate 18+ (`works.is_adult`) — SÓ LEITURA, US$0.
--
-- Lista A: obra ativa com nota adult_content >= 7 E is_adult = false.
-- Lista B: obra ativa com is_adult = true E nota adult_content < 7.
-- Seção 5: obra ativa com is_adult = true SEM nota (NULL não conta como < 7).
--
-- 🔴 Checagem OBRIGATÓRIA depois de aplicar a migration 203: só a lista rodada na NUVEM, DEPOIS
-- da 203, é "pós-correção". Rodada antes, ou sobre um retrato, ela é PROJEÇÃO.
--
-- Como rodar contra a nuvem, numa transação SÓ LEITURA (senha do Postgres no .env.supabase-cloud):
--   PGPASSWORD=… PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "host=db.<ref>.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" \
--     -X -v ON_ERROR_STOP=1 -P pager=off -f scripts/sql/divergencias-nota-adulta-x-18.sql
--
-- ⚠️ É UM comando só, de propósito: numa transação READ ONLY o Postgres recusa qualquer CREATE
-- (inclusive TEMP VIEW), e repetir a base em cada consulta seria a mesma régua escrita várias vezes.
-- As seções saem juntas, separadas pela coluna `secao`.
--
-- A classificação é TRIAGEM por regra, não veredito: aponta a causa provável a partir do que está
-- persistido (tags, motivo, override, edição, versão da avaliação). "inconclusiva" = precisa de
-- leitura da obra, não "está certo".
--
-- Lê só: works, tags, work_tags, category_scores, ai_evaluations, ai_evaluation_scores.

begin read only;

with
nota as (
  select cs.work_id, cs.score, cs.source, cs.ai_evaluation_id
    from category_scores cs where cs.criterion_slug = 'adult_content'
),
tg as (
  select wt.work_id,
    bool_or(t.adult_indicator_strong) as tem_strong,
    bool_or(t.adult_indicator and not t.adult_indicator_strong) as tem_soft,
    bool_or(t.adult_score_tier = 'explicit') as tem_piso9,
    bool_or(t.adult_score_tier = 'label') as tem_piso7,
    bool_or(t.slug = 'r15-but-based-on-a-r19-novel') as tem_r15_novel,
    bool_or(t.slug in ('r19', 'r19-version')) as tem_rotulo_r19,
    -- tags fortes que só descrevem anatomia/atributo, não uma cena
    bool_and(t.slug in ('big-breasts','big-penis','big-areolae','inverted-nipples','pubic-hair'))
      filter (where t.adult_indicator_strong) as strong_so_anatomia,
    string_agg(
      t.name
      || case when t.adult_indicator_strong then ' [gate]'
              when t.adult_indicator then ' [gate c/ nota]' else '' end
      || case t.adult_score_tier when 'explicit' then ' [piso 9]' when 'label' then ' [piso 7]' else '' end
      || case when t.marks_r19_edition then ' [edição R19]' else '' end,
      ', ' order by t.name) as sinais
  from work_tags wt join tags t on t.id = wt.tag_id
  where t.adult_indicator or t.adult_score_tier is not null or t.marks_r19_edition
     or t.slug in ('r15-but-based-on-a-r19-novel', 'r19', 'r19-version')
  group by wt.work_id
),
obra as (
  select
    w.id as work_id, w.title, n.score, w.is_adult, w.adult_auto, w.adult_override, w.adult_reason, w.r19_edition,
    coalesce(a.prompt_version, '(sem avaliação vinculada)') as versao,
    a.created_at::date as avaliada_em,
    case
      when a.prompt_version is null then 'sem avaliação vinculada'
      when a.prompt_version in ('v4','v16','v17','v18','v19','v20','v21','external-import') then 'pré-v22'
      else 'v22+'
    end as regime,
    coalesce(tg.tem_strong, false) as tem_strong, coalesce(tg.tem_soft, false) as tem_soft,
    coalesce(tg.tem_piso9, false) as tem_piso9, coalesce(tg.tem_piso7, false) as tem_piso7,
    coalesce(tg.tem_r15_novel, false) as tem_r15_novel, coalesce(tg.tem_rotulo_r19, false) as tem_rotulo_r19,
    coalesce(tg.strong_so_anatomia, false) as strong_so_anatomia,
    coalesce(tg.sinais, '—') as sinais,
    regexp_replace(coalesce(aes.justification, ''), '\s+', ' ', 'g') as justificativa
  from works w
  left join nota n on n.work_id = w.id
  left join ai_evaluations a on a.id = n.ai_evaluation_id
  left join ai_evaluation_scores aes on aes.ai_evaluation_id = n.ai_evaluation_id and aes.criterion_slug = 'adult_content'
  left join tg on tg.work_id = w.id
  where not w.is_archived
),
lista as (
  select 'A' as lista, o.*,
    case
      when o.adult_override = false then 'override manual'
      when o.r19_edition then 'mistura de edições'
      when not o.adult_auto and o.tem_soft then 'esperado: tag fraca não liga o gate'
      when not o.tem_strong and not o.tem_soft and (o.tem_piso7 or o.tem_piso9) and o.score in (7, 9) then 'provável problema de score'
      when o.regime = 'pré-v22' and o.justificativa ~* '(nota m[ií]nima|piso|regra obrigat)' then 'legado/stale'
      else 'inconclusiva'
    end as classe,
    case
      when o.adult_override = false then 'a curadoria decidiu: não é 18+'
      when o.adult_auto and o.r19_edition then 'sinal adulto suprimido por r19_edition (mig 199)'
      when o.r19_edition then 'r19_edition sem outro sinal adulto'
      when not o.adult_auto and o.tem_soft then 'tag fraca + nota >= 7: NÃO é regra do gate desde 2026-10-10 (nota e gate são dimensões diferentes)'
      when not o.tem_strong and not o.tem_soft and (o.tem_piso7 or o.tem_piso9) and o.score in (7, 9) then 'nota exatamente no piso de uma tag que NÃO liga o gate'
      when o.regime = 'pré-v22' and o.justificativa ~* '(nota m[ií]nima|piso|regra obrigat)' then 'nota de régua antiga, com piso citado na justificativa'
      when not o.tem_strong and not o.tem_soft then 'só a nota: nenhuma tag adulta (o gate não lê a nota sozinha)'
      else 'ler a obra'
    end as causa
  from obra o where o.score >= 7 and not o.is_adult
  union all
  select 'B', o.*,
    case
      when o.adult_override = true then 'override manual'
      when o.tem_r15_novel and o.tem_rotulo_r19 then 'mistura de edições'
      when o.adult_reason = 'ai_review' then 'legítima'
      when o.adult_auto and not o.tem_strong then 'legado/stale'
      when o.strong_so_anatomia then 'provável bug de gate'
      when o.tem_piso9 then 'legado/stale'
      else 'inconclusiva'
    end,
    case
      when o.adult_override = true then 'a curadoria decidiu: é 18+'
      when o.tem_r15_novel and o.tem_rotulo_r19 then 'o R19 é do NOVEL; a obra é R15 (teto 6 na nota)'
      when o.adult_reason = 'ai_review' then '2ª opinião de IA com evidência explícita'
      when o.adult_auto and not o.tem_strong then 'adult_auto sem tag forte: a regra (só tag forte) não o sustenta'
      when o.strong_so_anatomia then 'gate só por tag de anatomia/atributo, que não afirma cena'
      when o.tem_piso9 then 'tag de ato explícito (piso 9) com nota < 7: a tag chegou depois da avaliação'
      else 'gate por tag forte; ler se a cena é mostrada'
    end
  from obra o where o.is_adult and o.score < 7
),
ativas as (select count(*) as n from obra)
-- 1) Resumo
select '1 resumo' as secao, l.lista, null::text as classe, count(*) as qtd,
       round(100.0 * count(*) / (select n from ativas), 1) as pct_ativas,
       count(*) filter (where l.r19_edition) as dep_r19_edition,
       count(*) filter (where l.adult_override is not null) as dep_override,
       count(*) filter (where l.classe = 'legado/stale') as classe_stale,
       count(*) filter (where l.regime = 'pré-v22') as regime_pre_v22,
       null::uuid as work_id, null::text as titulo, null::numeric as nota, null::boolean as is_adult,
       null::boolean as adult_auto, null::boolean as adult_override, null::text as adult_reason,
       null::boolean as r19_edition, null::text as versao, null::date as avaliada_em, null::text as regime,
       null::text as sinais, null::text as causa
  from lista l group by l.lista
union all
select '1 resumo', 'R18 sem nota', null, count(*), round(100.0 * count(*) / (select n from ativas), 1),
       count(*) filter (where r19_edition), count(*) filter (where adult_override is not null), null,
       count(*) filter (where regime = 'pré-v22'), null, null, null, null, null, null, null, null, null, null, null, null, null
  from obra where is_adult and score is null
union all
-- 2) Distribuição por faixa (faixas da rubrica; meio ponto cai na de baixo)
select '2 faixa', l.lista,
       case when l.score < 4 then '0-3' when l.score < 7 then '4-6' when l.score < 9 then '7-8' else '9-10' end,
       count(*), round(100.0 * count(*) / (select n from ativas), 1), null, null, null, null,
       null, null, null, null, null, null, null, null, null, null, null, null, null
  from lista l group by 2, 3
union all
-- 3) Por classe
select '3 classe', l.lista, l.classe, count(*), round(100.0 * count(*) / (select n from ativas), 1),
       count(*) filter (where l.r19_edition), count(*) filter (where l.adult_override is not null),
       count(*) filter (where l.classe = 'legado/stale'), count(*) filter (where l.regime = 'pré-v22'),
       null, null, null, null, null, null, null, null, null, null, null, null, null
  from lista l group by 2, 3
union all
-- 4) As linhas
select '4 linhas', l.lista, l.classe, null, null, null, null, null, null,
       l.work_id, left(l.title, 50), l.score, l.is_adult, l.adult_auto, l.adult_override, l.adult_reason,
       l.r19_edition, l.versao, l.avaliada_em, l.regime, l.sinais, l.causa
  from lista l
union all
-- 5) R18 sem nota
select '5 r18 sem nota', null, null, null, null, null, null, null, null,
       o.work_id, left(o.title, 50), o.score, o.is_adult, o.adult_auto, o.adult_override, o.adult_reason,
       o.r19_edition, o.versao, o.avaliada_em, o.regime, o.sinais, null
  from obra o where o.is_adult and o.score is null
order by 1, 2, 3, 12 desc nulls last, 11;

rollback;
