-- ============================================================
-- 183 — works.publication_status_note + works.hiatus_kind:
--       "Hiatus" cobre duas situações opostas, e o catálogo não distinguia
-- ============================================================
-- "Hiatus" quer dizer uma de duas coisas, e elas levam a decisões contrárias de leitura:
--
--   • pausa ENTRE TEMPORADAS — a temporada fechou e a próxima está prometida ("S4: TBA",
--     "S2: Sep 2026"). A obra volta; esperar é o comportamento certo.
--   • publicação INTERROMPIDA no meio de uma temporada ("S2: 30 Chapters (Ongoing) 40~"),
--     por saúde do autor ou sem motivo anunciado. Pode não voltar.
--
-- 🔴 Isto NÃO virou valor novo de `publication_status`, e o motivo é medido. Das 9 fontes
-- externas, só o MangaUpdates traz o texto que explica a situação — as outras 8 devolvem
-- "Hiatus" e nada mais. O merge de `fetchMultiSourceDetails` fica com o status da PRIMEIRA
-- fonte aceita (`lib/external/index.ts`: `accepted.find((r) => r.publicationStatus)`), então
-- um status refinado seria rebaixado ao genérico na primeira "Atualizar dados" em que o
-- MangaDex respondesse antes — sem erro e sem log. `server/actions/reading.ts` grava status de
-- qualquer fonte na checagem de capítulos e faria o mesmo. Dimensão à parte não tem esse
-- problema: `publication_status_id` segue com 5 valores e ninguém disputa esta coluna.
--
-- 🔴 A segunda coluna conserta um erro de LUGAR que já existia. O "Status in Country of
-- Origin" do MU é FATO DA OBRA, e até aqui ele não tinha casa nenhuma no catálogo: o
-- work-form e o update-dialog o despejavam em `observations`, que desde a Fase F mora em
-- `user_work_state` — campo PESSOAL, escrito só quando estava vazio. Medido nas 97 obras em
-- hiato (2026-08-11), o resultado é o previsível: o texto da fonte convive com anotação da
-- curadora na mesma string ("Hiatus since 11/20/2025 ⏎ Sem explicação do motivo ⏎ S4: 52
-- Chapters (129-180)"). Em multi-user isso é pior que feio — o fato da obra ficaria guardado
-- na linha de UMA pessoa, e um leitor novo não teria nada.
--
-- ⚠️ `hiatus_kind` é DERIVADO de `publication_status_note` (regra em lib/external/hiatus-kind.ts).
-- As duas andam juntas de propósito: guardar o texto cru ao lado do veredito é o que permite
-- afinar a regra e reclassificar o catálogo inteiro sem uma requisição de rede.
--
-- Cobertura medida da regra sobre as 97: 68 entre-temporadas + 18 interrompidas com confiança
-- alta (88,7%), 5 com confiança baixa, 6 indeterminadas.
-- ============================================================

set lock_timeout = '5s';

alter table public.works
  add column if not exists publication_status_note text,
  add column if not exists hiatus_kind text,
  add column if not exists hiatus_kind_confidence text;

do $$
begin
  -- ⚠️ NULL em `hiatus_kind` é RESULTADO ("o texto não sustenta nenhuma das duas"), não
  -- ausência de processamento. 6 das 97 só dizem "27 Chapters (Hiatus)". Sem a terceira
  -- saída, elas receberiam um dos dois rótulos por default — e rótulo errado aqui é pior que
  -- rótulo nenhum, porque a tela o apresenta como conferido.
  if not exists (select 1 from pg_constraint where conname = 'works_hiatus_kind_valid') then
    alter table public.works add constraint works_hiatus_kind_valid
      check (hiatus_kind is null or hiatus_kind in ('between_seasons', 'mid_season'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'works_hiatus_kind_confidence_valid') then
    alter table public.works add constraint works_hiatus_kind_confidence_valid
      check (hiatus_kind_confidence is null or hiatus_kind_confidence in ('high', 'low'));
  end if;

  -- As duas nascem e morrem juntas: veredito sem confiança faz a UI afirmar com a mesma
  -- ênfase um "S4: TBA" explícito e um "a temporada fechou e ninguém anunciou nada".
  if not exists (select 1 from pg_constraint where conname = 'works_hiatus_kind_confidence_pareada') then
    alter table public.works add constraint works_hiatus_kind_confidence_pareada
      check ((hiatus_kind is null) = (hiatus_kind_confidence is null));
  end if;
end $$;

create index if not exists idx_works_hiatus_kind on public.works (hiatus_kind)
  where hiatus_kind is not null;

-- ============================================================
-- A obra que SAI do hiato não pode ficar com tipo de hiato
-- ============================================================
-- 🔴 A invariante mora aqui, e não no código de escrita, porque são MUITOS escritores de
-- `publication_status_id` e o mais provável de esquecer é o menos visível: além de `updateWork`
-- e `updateWorkExternalData`, o `server/actions/reading.ts` grava status de FIM/HIATO vindo de
-- qualquer fonte durante a checagem de capítulos — sem passar perto deste assunto. Exigir que
-- cada um lembre de zerar é o desenho que já falhou em `LOW_BALANCE_USD` e `STRONG_TAG_WEIGHT`.
--
-- E não é caso raro: das 97 obras em hiato medidas em 2026-08-11, **13 (13,4%)** já estavam
-- `(Ongoing)` no MU. Elas exibiriam "pausa entre temporadas" com a publicação correndo.
--
-- ⚠️ O caminho INVERSO (voltar a entrar em hiato) deixa `hiatus_kind` NULL de propósito: a
-- regra que classifica é TypeScript (`lib/external/hiatus-kind.ts`), o Postgres não a alcança,
-- e NULL quer dizer "indeterminado" — o lado seguro. A próxima "Atualizar dados" reclassifica
-- a partir de `publication_status_note`, que continua guardada.
create or replace function public.clear_hiatus_kind_when_not_hiatus()
returns trigger
language plpgsql
as $$
begin
  if new.publication_status_id is distinct from
     (select id from public.publication_status where slug = 'hiatus')
  then
    new.hiatus_kind := null;
    new.hiatus_kind_confidence := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_clear_hiatus_kind on public.works;
create trigger trg_clear_hiatus_kind
  before insert or update of publication_status_id, hiatus_kind on public.works
  for each row execute function public.clear_hiatus_kind_when_not_hiatus();

comment on column public.works.publication_status_note is
  'Texto cru de "Status in Country of Origin" do MangaUpdates — FATO DA OBRA. Não confundir '
  'com user_work_state.observations, que é anotação PESSOAL do leitor; até a migration 183 '
  'este texto era despejado lá, e os dois se misturavam na mesma string.';
comment on column public.works.hiatus_kind is
  'Derivado de publication_status_note por lib/external/hiatus-kind.ts. between_seasons = a '
  'temporada fechou e a próxima está prometida; mid_season = parou no meio de uma temporada. '
  'NULL = o texto não sustenta nenhuma das duas (resultado legítimo), ou a obra não está em '
  'hiato. Não é status: publication_status_id segue sendo a fonte de "Hiatus".';
comment on column public.works.hiatus_kind_confidence is
  'high = a última linha S<n>: decide sozinha (range aberto ou próxima anunciada). low = o '
  'sinal é indireto (temporada fechou sem anúncio, ou só o motivo declarado). A UI não deve '
  'afirmar a distinção sem ressalva quando for low.';
