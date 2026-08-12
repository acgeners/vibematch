-- ============================================================
-- 185 — works.opening_structure: a obra abre com FLASHFORWARD ou no início cronológico?
-- ============================================================
-- A régua é UMA pergunta: **a narrativa principal REENCONTRA a cena de abertura?**
--
--   • flashforward — sim. O leitor vê o "depois" antes do "antes", e a história chega lá.
--   • linear       — não. Inclui o padrão mais comum deste catálogo: a obra abre com a MORTE
--                    da protagonista e ela regride/reencarna. Essa cena pertence a uma linha
--                    que foi SUBSTITUÍDA — a nova existe para evitá-la e nunca a alcança.
--
-- 🔴 A tag `time-skip-in-first-chapter-prologue` NÃO responde isto, e é por isso que a coluna
-- existe. Das 42 obras que a têm, **22 (52,4%)** também têm regressão/reencarnação: para
-- metade, a tag marca o setup isekai, não flashforward. Usá-la como proxy erraria em metade
-- dos casos — e erraria para o lado que a tela apresenta como conferido.
--
-- ⚠️ Isto não é derivável de nada que já esteja no catálogo. Medido em 2026-08-12 sobre 988
-- obras: regex por vocabulário de flashforward acha **7 (0,7%)**, porque o leitor escreve
-- "end at the beginning", "don't read the first chapter", "they show us towards the end" — o
-- vocabulário é livre e nenhum padrão o cobre. Quem responde é um modelo lendo as reviews.
--
-- ============================================================
-- Por que DUAS colunas de veredito e não uma
-- ============================================================
-- Piloto de 19 obras (US$1,40, `scripts/piloto-flashforward.ts`): **6 decididas, 13 sem
-- evidência suficiente**. Fora dos 3 controles — que eu havia escolhido justamente por já ter
-- resposta conhecida — a taxa real é **3 em 16 (19%)**.
--
-- Com 81% caindo em "não sei", o override humano deixa de ser acessório e vira o caminho
-- principal: a IA cobre as obras sobre as quais alguém já escreveu, e a curadora cobre o resto
-- em 30 segundos de leitura do capítulo 1. Daí o padrão de `works.adult_override` — auto e
-- override coexistem, `opening_structure` é a coluna GERADA que a UI lê, e desfazer o override
-- (setar NULL) devolve o veredito da IA em vez de apagar tudo.
--
-- ⚠️ `opening_structure_override` aceita só os dois valores AFIRMATIVOS. "Não sei" não é uma
-- marcação humana — é o estado que já existe quando não há override e o auto é 'indeterminado'
-- ou nulo. Um override 'indeterminado' seria indistinguível de "ninguém olhou ainda".
-- ============================================================

set lock_timeout = '5s';

alter table public.works
  add column if not exists opening_structure_auto text,
  add column if not exists opening_structure_auto_confidence numeric(3,2),
  add column if not exists opening_structure_auto_evidence text,
  add column if not exists opening_structure_auto_rationale text,
  add column if not exists opening_structure_auto_source text,
  add column if not exists opening_structure_auto_model text,
  add column if not exists opening_structure_auto_at timestamptz,
  add column if not exists opening_structure_override text;

-- A coluna que a UI e os filtros leem. Gerada, então nenhum escritor precisa lembrar de
-- recalcular — e nenhum consumidor precisa saber que existem duas fontes.
alter table public.works
  add column if not exists opening_structure text
    generated always as (coalesce(opening_structure_override, opening_structure_auto)) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_auto_valid') then
    alter table public.works add constraint works_opening_structure_auto_valid
      check (opening_structure_auto is null
             or opening_structure_auto in ('flashforward', 'linear', 'indeterminado'));
  end if;

  -- Só os dois afirmativos — ver o ⚠️ do cabeçalho.
  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_override_valid') then
    alter table public.works add constraint works_opening_structure_override_valid
      check (opening_structure_override is null
             or opening_structure_override in ('flashforward', 'linear'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_source_valid') then
    alter table public.works add constraint works_opening_structure_source_valid
      check (opening_structure_auto_source is null
             or opening_structure_auto_source in ('local', 'web'));
  end if;

  -- 🔴 A INVARIANTE QUE IMPORTA: veredito decidido EXIGE citação literal.
  --
  -- No piloto isto era um `if` no script, e um `if` protege um escritor. A regra precisa valer
  -- para todos — a action, um backfill futuro, um `update` à mão no Studio. Sem ela, o modo de
  -- falha é o que o piloto foi desenhado para impedir: com 320 obras de reencarnação no
  -- catálogo, "flashforward" é o chute PLAUSÍVEL, e um veredito sem evidência é
  -- indistinguível na tela de um com evidência.
  --
  -- 'indeterminado' é isento porque a ausência de evidência é justamente o que ele afirma.
  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_exige_evidencia') then
    alter table public.works add constraint works_opening_structure_exige_evidencia
      check (opening_structure_auto is null
             or opening_structure_auto = 'indeterminado'
             or (opening_structure_auto_evidence is not null
                 and length(btrim(opening_structure_auto_evidence)) >= 15));
  end if;

  -- Veredito e carimbo nascem juntos: sem data, a tela não sabe se o "não sei" é de hoje ou de
  -- antes de a obra ganhar 40 reviews novas — que é exatamente quando vale reanalisar.
  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_at_pareado') then
    alter table public.works add constraint works_opening_structure_at_pareado
      check ((opening_structure_auto is null) = (opening_structure_auto_at is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'works_opening_structure_conf_range') then
    alter table public.works add constraint works_opening_structure_conf_range
      check (opening_structure_auto_confidence is null
             or (opening_structure_auto_confidence >= 0 and opening_structure_auto_confidence <= 1));
  end if;
end $$;

-- Índice parcial: o filtro útil é "quais obras têm veredito", e ele cobre ~19% da tabela.
create index if not exists idx_works_opening_structure on public.works (opening_structure)
  where opening_structure is not null;

comment on column public.works.opening_structure is
  'GERADA: coalesce(override, auto). É a coluna que a UI e os filtros devem ler — nunca as duas '
  'fontes separadamente. flashforward = a obra abre com cena que a narrativa depois alcança; '
  'linear = começa no início cronológico (inclui prólogo de regressão, em que a cena de abertura '
  'pertence a uma linha substituída); indeterminado = a evidência não sustenta nenhum dos dois; '
  'NULL = nunca analisada.';
comment on column public.works.opening_structure_auto is
  'Veredito da IA (lib/works/opening-structure.ts). "indeterminado" é RESULTADO, não falha: foi '
  '13 de 19 no piloto, e é a resposta certa quando o material só descreve o enredo e não a ordem '
  'em que os eventos são apresentados.';
comment on column public.works.opening_structure_auto_evidence is
  'Citação LITERAL do material que sustenta o veredito. Obrigatória por CHECK quando o veredito '
  'é afirmativo — ver works_opening_structure_exige_evidencia. É o que separa esta coluna de um '
  'palpite, e por isso a UI a mostra na tela, não em tooltip.';
comment on column public.works.opening_structure_auto_source is
  'local = decidido pela síntese e reviews já no banco (~US$0,016/obra). web = precisou de busca '
  'externa (~US$0,25 e ~1 resgate em 5 no piloto). A distinção existe porque a segunda é ~15× '
  'mais cara e o usuário a dispara explicitamente.';
comment on column public.works.opening_structure_override is
  'Marcação humana; NULL = usar o veredito da IA. Aceita só flashforward|linear — "não sei" não '
  'é marcação, é a ausência dela. Com 81% de indeterminados, este é o caminho principal, não a '
  'exceção.';
