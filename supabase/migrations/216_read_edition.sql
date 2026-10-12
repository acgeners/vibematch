-- 216 — A versão que a AVALIAÇÃO descreve (obra `mixed`): `user_work_state.read_edition`
--
-- O PROBLEMA: desde a fase 2 uma obra `mixed` tem duas versões (normal e R18), cada uma com o próprio
-- `adult_content`, e a nota de quem leu (`user_score`, nota rápida, pós-leitura, piloto) não dizia
-- QUAL versão foi lida. O treino usava a nota misturada de `category_scores` para esses rótulos.
--
-- O QUE ESTA MIGRATION FAZ (decisão de produto de 2026-10-12, D1 = "uma avaliação por obra, com a
-- versão registrada nela"):
--   1. `user_work_state.read_edition` (`normal` | `r18` | NULL) — a versão da avaliação ATUAL daquela
--      obra. Vale para a avaliação inteira (nota, nota rápida, pós-leitura, piloto): não há versões
--      divergentes dentro dela. NULL = desconhecida (histórico, importação) ou sem avaliação.
--      `read_edition_source` diz de onde veio: `active_version` (a versão efetiva da tela ao criar a
--      avaliação), `user_choice` (a pessoa trocou a versão da avaliação) ou `explicit_user_decision`
--      (o backfill abaixo). O par é travado por CHECK: versão sem origem (ou o contrário) não existe.
--   2. BACKFILL de UMA conta: as 55 avaliações de obras `mixed` da conta PRINCIPAL viram `r18`, por
--      decisão EXPLÍCITA da usuária sobre o próprio histórico (não é inferência — 11 delas o
--      levantamento de 10/10 chamou de `likely_r18`, 44 de `unknown`). Nenhuma outra conta é tocada; a
--      leitora tem 0 avaliações mixed. Futuras avaliações antigas sem versão seguem NULL.
--
-- O QUE NÃO FAZ: não toca nota, status, notas por edição, previsões, gate, overrides, contrato. Não
-- permite duas avaliações da mesma obra (a chave segue `(user_id, work_id)`).
--
-- GUARDAS: a conta-alvo é a do app (`getOwnerUserId` = a linha mais antiga de `user_settings`) e tem de
-- ser `curador`; o alvo tem de ser EXATAMENTE as 55 obras do levantamento (contagem + hash do conjunto
-- de ids); nenhum piloto/pós-leitura/atributo da dona em obra mixed pode estar fora delas; e depois do
-- update nada fora das 55 pode ter versão. Qualquer divergência ABORTA — nunca backfill parcial.
--
-- IDEMPOTENTE (reexecução não muda nada). ROLLBACK: `scripts/rollback/216_rollback.sql`.

set lock_timeout = '5s';

do $guarda$
begin
  if to_regclass('public.work_edition_state') is null or to_regclass('public.work_edition_scores') is null then
    raise exception 'mig 216: as migrations 204/213 não estão aplicadas — abortando';
  end if;
end
$guarda$;

alter table public.user_work_state add column if not exists read_edition text;
alter table public.user_work_state add column if not exists read_edition_source text;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_work_state_read_edition_check') then
    alter table public.user_work_state add constraint user_work_state_read_edition_check
      check (read_edition is null or read_edition in ('normal', 'r18'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_work_state_read_edition_source_check') then
    alter table public.user_work_state add constraint user_work_state_read_edition_source_check
      check (read_edition_source is null or read_edition_source in ('active_version', 'user_choice', 'explicit_user_decision'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_work_state_read_edition_par') then
    alter table public.user_work_state add constraint user_work_state_read_edition_par
      check ((read_edition is null) = (read_edition_source is null));
  end if;
end
$c$;

comment on column public.user_work_state.read_edition is
  'Versão (normal | r18) que a AVALIAÇÃO ATUAL desta obra descreve — obra mixed. NULL = desconhecida '
  '(histórico/importação) ou sem avaliação. Uma avaliação por obra; trocar de versão troca a da avaliação. Mig 216.';
comment on column public.user_work_state.read_edition_source is
  'De onde veio read_edition: active_version (versão efetiva da tela ao criar a avaliação), user_choice '
  '(a pessoa trocou a versão da avaliação), explicit_user_decision (backfill da conta principal, mig 216).';

-- ── Backfill: SÓ as 55 avaliações mixed da conta principal ─────────────────────────────────
do $b$
declare
  v_dona uuid;
  v_papel text;
  n_alvo int;
  v_hash text;
  n int;
begin
  -- A conta principal pela MESMA régua do app (`getOwnerUserId` → singleton = linha mais antiga).
  select current_user_id, role into v_dona, v_papel from public.user_settings order by created_at asc limit 1;
  if v_dona is null or v_papel is distinct from 'curador' then
    raise exception 'mig 216: a conta principal não é a esperada (papel %) — abortando', coalesce(v_papel, '<sem linha>');
  end if;

  drop table if exists pg_temp.mig216_alvo;
  create temp table mig216_alvo on commit drop as
    select u.work_id
      from public.user_work_state u join public.works w on w.id = u.work_id
     where u.user_id = v_dona and w.edition_state = 'mixed'
       and (u.user_score is not null or u.quick_score is not null
            or coalesce(u.post_story_score, u.post_fl_score, u.post_ml_score, u.post_character_development_score,
                        u.post_pacing_score, u.post_art_visual_score, u.post_impact_immersion_score,
                        u.post_originality_score) is not null);

  select count(*), md5(string_agg(work_id::text, ',' order by work_id)) into n_alvo, v_hash from pg_temp.mig216_alvo;
  if n_alvo <> 55 or v_hash <> '37aadc0f9aa149f14610601b0196933b' then
    raise exception 'mig 216: o alvo não é o do levantamento (% avaliações, hash %) — esperava 55 / 37aadc0f… — abortando', n_alvo, v_hash;
  end if;
  -- A avaliação é uma só: nada dela (piloto, atributo pós-leitura) pode estar fora do alvo.
  if exists (select 1 from public.pilot_taste_scores p join public.works w on w.id = p.work_id
              where p.user_id = v_dona and w.edition_state = 'mixed' and p.work_id not in (select work_id from pg_temp.mig216_alvo))
     or exists (select 1 from public.user_attribute_assessment a join public.works w on w.id = a.work_id
              where a.user_id = v_dona and w.edition_state = 'mixed' and a.work_id not in (select work_id from pg_temp.mig216_alvo)) then
    raise exception 'mig 216: há piloto/atributo da conta principal em obra mixed fora das 55 avaliações — abortando';
  end if;
  -- Antes: nenhuma versão gravada fora do alvo (reexecução só reencontra as 55).
  if exists (select 1 from public.user_work_state where read_edition is not null
              and not (user_id = v_dona and work_id in (select work_id from pg_temp.mig216_alvo))) then
    raise exception 'mig 216: já existe versão gravada fora das 55 avaliações — abortando';
  end if;

  update public.user_work_state u
     set read_edition = 'r18', read_edition_source = 'explicit_user_decision'
   where u.user_id = v_dona and u.work_id in (select work_id from pg_temp.mig216_alvo)
     and u.read_edition is null;
  get diagnostics n = row_count;

  -- Depois: exatamente as 55, todas r18 por decisão explícita, e nenhuma outra linha com versão.
  if (select count(*) from public.user_work_state where read_edition is not null) <> 55
     or (select count(*) from public.user_work_state
          where read_edition = 'r18' and read_edition_source = 'explicit_user_decision'
            and user_id = v_dona and work_id in (select work_id from pg_temp.mig216_alvo)) <> 55 then
    raise exception 'mig 216: depois do backfill o conjunto com versão não é exatamente as 55 — abortando';
  end if;
  raise notice 'mig 216: % avaliação(ões) da conta principal marcadas r18 (55 no total, explicit_user_decision)', n;
end
$b$;
