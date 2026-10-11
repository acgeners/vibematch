-- 210 — Gate 18+ só por tag FORTE; tags adultas reclassificadas; aliases; proveniência do enriquecimento
--
-- ✅ APLICADA EM PRODUÇÃO em 2026-10-11 03:53Z, na mesma transação que a 211 e a 212 (PR #553,
-- merge 2603971; código no ar na release Fly v41). Ensaiada antes em retratos descartáveis da nuvem
-- (o último: backup de 2026-10-11T03:50Z) e conferida por `npm run test:db-tags-adultas`.
--
-- DECISÕES DE PRODUTO EM QUE ISTO SE APOIA (Ana, 2026-10-10, fechadas — não reabrir aqui):
--   · o gate 18+ protege contra conteúdo sexual EXPLICITAMENTE mostrado/descrito — não contra obra
--     sexual, madura ou sugestiva;
--   · REMOVIDA a regra "tag adulta fraca + adult_content ≥ 7 ⇒ R18": gate e nota são dimensões
--     diferentes; a tag genérica não prova explicitness; a nota tem legado e pisos que a inflam.
--     O gate passa a ser: ≥ 1 tag FORTE ⇒ `adult_auto` (lib/tags/adult-classify.ts, dono em TS);
--   · D1 circunstância/posição do ato (First-Time, Drunken, Outdoor, Doggy Style…) NÃO liga sozinha;
--     D2a descritores (Nudity, Fetish…) = sinal fraco; D2b traço/enredo/ocupação = sem sinal;
--     D3 anatomia não genital = no máximo fraca; D5/D6 contenção/enredo = forte → fraca;
--     D4 citadas (Necrophilia, Somnophilia, Sleep Intercourse, Bestiality, Cousin Incest) e anatomia
--     genital (Big Penis, Pubic Hair) = forte → fraca; as demais D4 ficam como estão;
--     residuais das mixed: Realistic Breasts e Condom/s = fraca; Big-Breasted Female Lead, Blindfold
--     e Asphyxiation = sem sinal;
--   · aliases: só existem quando os dois termos significam essencialmente a mesma coisa. smut → Smut ·
--     hentai → Hentai · ecchi não vira Smut · erotica à parte · mature não vira Adult sexual · alias que
--     inventa ato é removido · `r15` não inventa "baseado em novel R19" · 14 aliases de conceito apenas
--     RELACIONADO saem (submission → BDSM, spanking → Whipping, dubious-consent → Sexual Abuse…) · e os
--     2 de sentido INVERTIDO (english-company-added-censorship → Uncensored Version Available;
--     abused-family-member-s → Abusive Family Member/s).
--
-- O QUE FAZ:
--   1. Proveniência: `tags.enrichment_status` (+ `_at`, `_detail`). Tag existente vira `legacy`; tag
--      NOVA nasce `pending` e só `enrichNewTags` a leva a `done` (lib/tags/enrichment-status.ts).
--   2. Sinal do gate de 108 tags (tabela abaixo; NÃO toca `adult_score_tier`, `work_tags` nem nota).
--   3. As 4 tags de 2026-10-08 06:15 que passaram SEM chamada de IA e saíram com cara de avaliadas:
--      voltam a "sem grupo", sem a marca de revisão do piso, `provider_not_called` (pendentes).
--   4. Aliases (só os claros; só valem para ingestão FUTURA — vínculo gravado não muda).
--   5. Recalcula `adult_auto`/`adult_reason` com a regra NOVA, de toda obra em que ela difere do
--      estado gravado. Motivo `ai_review` (2ª opinião de IA com evidência explícita) não é tocado;
--      override e estado de edição seguem decidindo o `is_adult` (coluna gerada). A causa de cada
--      mudança fica em `bkp.mig210_works_antes.causa`.
--
-- O QUE NÃO FAZ: não lê a nota para decidir nada; não altera `category_scores`, `work_tags`,
-- `adult_override`, `edition_state` nem `adult_score_tier`; não cria piso/teto. Os vínculos R19 que
-- `scripts/tag-r19-adult.ts` criou a partir da nota em 2026-07-09 são outra responsabilidade: a
-- limpeza deles mora na 211.
--
-- IDEMPOTENTE. ROLLBACK: `scripts/rollback/210_rollback.sql` (depois do da 211, se ela foi aplicada).
-- ⚠️ ORDEM DE DEPLOY: 210 → 211 → código (o código grava `enrichment_status` e aplica a regra nova a
-- cada mudança de tag).

set lock_timeout = '5s';

-- ── 0) Os conjuntos decididos ──────────────────────────────────────────────────────────────
drop table if exists pg_temp.mig210_tags;
create temp table mig210_tags (
  slug text primary key, name text not null,
  ind_antes boolean not null, strong_antes boolean not null, tier text,
  ind_depois boolean not null, strong_depois boolean not null, motivo text not null
) on commit drop;
insert into mig210_tags values
  ('sex-toy-s', 'Sex Toy/s', false, false, 'explicit', true, true, 'piso explicit (mig 174) afirma cena mostrada: liga o gate'),
  ('strap-on', 'Strap-On', false, false, 'explicit', true, true, 'nomeia ato explícito; piso explicit'),
  ('facial', 'Facial', false, false, 'explicit', true, true, 'nomeia ato explícito; piso explicit'),
  ('sexually-active-protagonist', 'Sexually Active Protagonist', true, false, null, false, false, 'D2b: fato de enredo (o contrato do enricher a cita como não-indicador)'),
  ('female-lead-has-multiple-sexual-partners', 'Female Lead Has Multiple Sexual Partners', true, false, null, false, false, 'D2b: fato de enredo'),
  ('male-lead-has-multiple-sexual-partners', 'Male Lead Has Multiple Sexual Partners', true, false, null, false, false, 'D2b: fato de enredo'),
  ('multiple-wives', 'Multiple Wives', true, false, null, false, false, 'não é conteúdo sexual (estrutura familiar)'),
  ('stepsibling-love', 'Stepsibling Love', true, false, null, false, false, 'não é conteúdo sexual (romance)'),
  ('contraceptive-s', 'Contraceptive/s', true, false, null, false, false, 'não é conteúdo sexual (objeto)'),
  ('korean-bl', 'Korean BL', true, false, null, false, false, 'não é conteúdo sexual (formato)'),
  ('prostitution', 'Prostitution', true, true, null, false, false, 'D2b: tema/ocupação'),
  ('horny-character-s', 'Horny Character/s', true, false, null, false, false, 'D2b: traço de personagem'),
  ('perverted-male-lead', 'Perverted Male Lead', true, false, null, false, false, 'D2b: traço de personagem'),
  ('perverted-protagonist', 'Perverted Protagonist', true, false, null, false, false, 'D2b: traço de personagem'),
  ('sexually-insatiable-character-s', 'Sexually Insatiable Character/s', true, false, null, false, false, 'D2b: traço de personagem'),
  ('exhibitionist-female-lead', 'Exhibitionist Female Lead', true, false, null, false, false, 'D2b: traço de personagem'),
  ('exhibitionist-male-lead', 'Exhibitionist Male Lead', true, false, null, false, false, 'D2b: traço de personagem'),
  ('playgirl-s', 'Playgirl/s', true, false, null, false, false, 'D2b: traço de personagem'),
  ('milf-s', 'Milf/s', true, false, null, false, false, 'D2b: traço/papel de personagem'),
  ('dilf-s', 'Dilf/s', true, false, 'label', false, false, 'D2b: traço/papel de personagem'),
  ('incubus-bi', 'Incubus/bi', true, false, null, false, false, 'D2b: espécie/papel'),
  ('succubus-female-lead', 'Succubus Female Lead', true, false, null, false, false, 'D2b: espécie/papel'),
  ('porn-addict-s', 'Porn Addict/s', true, false, null, false, false, 'D2b: traço de personagem'),
  ('sex-partner-s', 'Sex Partner/s', true, false, null, false, false, 'D2b: tipo de relação'),
  ('perverted-couple', 'Perverted Couple', true, false, null, false, false, 'D2b: traço do casal'),
  ('sex-teacher-s', 'Sex Teacher/s', true, false, null, false, false, 'D2b: ocupação'),
  ('sex-club', 'Sex Club', true, false, null, false, false, 'D2b: cenário'),
  ('sex-based-powers', 'Sex-Based Powers', true, false, null, false, false, 'D2b: mecânica de enredo'),
  ('sexual-curse-s', 'Sexual Curse/s', true, false, null, false, false, 'D2b: mecânica de enredo'),
  ('cure-healing-with-sexual-interaction', 'Cure/Healing With Sexual Interaction', true, false, null, false, false, 'D2b: mecânica de enredo'),
  ('drawn-by-hentai-artist', 'Drawn by Hentai Artist', true, false, null, false, false, 'D2b: autoria (não descreve a obra)'),
  ('mating-cycles-in-heat', 'Mating Cycles/In Heat', true, false, null, false, false, 'D2b: biologia de enredo'),
  ('reverse-netorare', 'Reverse Netorare', true, false, null, false, false, 'D2b: dinâmica de enredo'),
  ('courtesan-s', 'Courtesan/s', true, false, null, false, false, 'D2b: ocupação'),
  ('prostitute-female-lead', 'Prostitute Female Lead', true, false, null, false, false, 'D2b: ocupação'),
  ('male-prostitute-s', 'Male Prostitute/s', true, false, null, false, false, 'D2b: ocupação'),
  ('male-prostitution', 'Male Prostitution', true, false, null, false, false, 'D2b: tema/ocupação'),
  ('gigolo', 'Gigolo', true, false, null, false, false, 'D2b: ocupação'),
  ('red-light-district', 'Red-Light District', true, false, null, false, false, 'D2b: cenário'),
  ('brothel-s', 'Brothel/s', true, false, null, false, false, 'D2b: cenário'),
  ('sexual-issues', 'Sexual Issues', true, false, null, false, false, 'D2b: tema'),
  ('sex-education', 'Sex Education', true, false, null, false, false, 'D2b: atividade'),
  ('nude-modeling', 'Nude Modeling', true, false, null, false, false, 'D2b: atividade/ocupação'),
  ('chastity-belt', 'Chastity Belt', true, false, null, false, false, 'D2b: objeto'),
  ('hypersexuality', 'Hypersexuality', true, true, 'label', false, false, 'D2b: condição de personagem (0 obras)'),
  ('outdoor-intercourse', 'Outdoor Intercourse', true, true, 'label', true, false, 'D1: circunstância do ato não liga sozinha'),
  ('school-intercourse', 'School Intercourse', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('toilet-intercourse', 'Toilet Intercourse', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('prison-sex', 'Prison Sex', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('clothed-intercourse', 'Clothed Intercourse', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('mirror-sex', 'Mirror Sex', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('pregnancy-sex', 'Pregnancy Sex', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('enemies-have-sex', 'Enemies Have Sex', true, true, 'label', true, false, 'D1: circunstância (relação)'),
  ('public-sex', 'Public Sex', true, true, 'label', true, false, 'D1: circunstância do ato'),
  ('doggy-style', 'Doggy Style', true, true, 'label', true, false, 'D1: posição'),
  ('cowgirl-position', 'Cowgirl Position', true, true, 'label', true, false, 'D1: posição'),
  ('missionary-position', 'Missionary Position', true, true, 'label', true, false, 'D1: posição'),
  ('sitting-sex', 'Sitting Sex', true, true, 'label', true, false, 'D1: posição'),
  ('reverse-cowgirl-position', 'Reverse Cowgirl Position', true, true, null, true, false, 'D1: posição'),
  ('missionary', 'Missionary', true, true, null, true, false, 'D1: posição'),
  ('amazon-position', 'Amazon Position', true, true, 'explicit', true, false, 'D1: posição'),
  ('hidden-sex', 'Hidden Sex', true, true, null, true, false, 'D1: circunstância do ato'),
  ('anonymous-sex', 'Anonymous Sex', true, true, null, true, false, 'D1: circunstância do ato'),
  ('locker-sex', 'Locker Sex', true, true, null, true, false, 'D1: circunstância do ato'),
  ('university-intercourse', 'University Intercourse', true, true, null, true, false, 'D1: circunstância do ato'),
  ('workplace-intercourse', 'Workplace Intercourse', true, true, null, true, false, 'D1: circunstância do ato'),
  ('sex-in-front-of-an-audience', 'Sex in Front of an Audience', true, true, null, true, false, 'D1: circunstância do ato'),
  ('balcony-sex', 'Balcony Sex', true, true, 'explicit', true, false, 'D1: circunstância do ato'),
  ('unprotected-intercourse', 'Unprotected Intercourse', true, true, 'explicit', true, false, 'D1: circunstância do ato'),
  ('bareback', 'Bareback', true, true, null, true, false, 'D1: circunstância do ato (= Unprotected Intercourse)'),
  ('nudity', 'Nudity', false, false, null, true, false, 'D2a: descritor de conteúdo sexual (sinal fraco)'),
  ('fetish-es', 'Fetish/es', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('dirty-talk', 'Dirty Talk', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('sensitive-body', 'Sensitive Body', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('sexual-teasing', 'Sexual Teasing', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('lust', 'Lust', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('aphrodisiac', 'Aphrodisiac', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('tl-teens-love', 'TL/Teens'' Love', false, false, null, true, false, 'D2a: rótulo de gênero erótico'),
  ('sex-friend-s', 'Sex Friend/s', false, false, null, true, false, 'D2a: descritor de conteúdo sexual'),
  ('femdom-female-dominance', 'Femdom / Female Dominance', false, false, null, true, false, 'D2a: dinâmica sexual'),
  ('maledom-male-dominance', 'Maledom / Male Dominance', false, false, null, true, false, 'D2a: dinâmica sexual'),
  ('petplay', 'Petplay', false, false, null, true, false, 'D2a: prática sexual'),
  ('big-breasts', 'Big Breasts', true, true, null, true, false, 'D3: anatomia não genital, no máximo fraca'),
  ('big-areolae', 'Big Areolae', true, true, null, true, false, 'D3: anatomia não genital'),
  ('inverted-nipples', 'Inverted Nipples', true, true, null, true, false, 'D3: anatomia não genital'),
  ('nipples', 'Nipples', false, false, null, true, false, 'D3: anatomia/exposição não genital'),
  ('breast-grabbing', 'Breast Grabbing', false, false, null, true, false, 'D3: toque sexual (não afirma cena explícita sozinho)'),
  ('whipping', 'Whipping', true, true, null, true, false, 'D5: contenção/castigo não afirma sexo mostrado'),
  ('gagged', 'Gagged', true, true, null, true, false, 'D5: contenção'),
  ('tentacles', 'Tentacles', true, true, null, true, false, 'D5: monstro/ato ambíguo'),
  ('voyeurism', 'Voyeurism', true, true, null, true, false, 'D5: espiar não afirma cena'),
  ('sexual-favors', 'Sexual Favors', true, true, null, true, false, 'D6: enredo'),
  ('impregnation', 'Impregnation', true, true, null, true, false, 'D6: enredo'),
  ('estrus', 'Estrus', true, true, null, true, false, 'D6: biologia de enredo'),
  ('lactation', 'Lactation', true, true, null, true, false, 'D6: amamentação/fetiche ambíguo'),
  ('sex-training', 'Sex Training', true, true, null, true, false, 'D6: enredo'),
  -- Consolidação (Ana, 2026-10-10): D4 citadas e anatomia genital não ligam o gate sozinhas → fraca.
  ('necrophilia', 'Necrophilia', true, true, null, true, false, 'D4: limítrofe; não liga o gate sozinha (sinal fraco)'),
  ('somnophilia', 'Somnophilia', true, true, null, true, false, 'D4: limítrofe; não liga o gate sozinha (sinal fraco)'),
  ('sleep-intercourse', 'Sleep Intercourse', true, true, null, true, false, 'D4: limítrofe; não liga o gate sozinha (sinal fraco)'),
  ('bestiality', 'Bestiality', true, true, 'explicit', true, false, 'D4: limítrofe; não liga o gate sozinha (sinal fraco; piso intocado)'),
  ('cousin-cousin-incest', 'Cousin-Cousin Incest', true, true, null, true, false, 'D4: limítrofe; não liga o gate sozinha (sinal fraco)'),
  ('big-penis', 'Big Penis', true, true, null, true, false, 'anatomia genital: não afirma cena mostrada (sinal fraco)'),
  ('pubic-hair', 'Pubic Hair', true, true, null, true, false, 'anatomia genital: não afirma cena mostrada (sinal fraco)'),
  -- Consolidação: as 5 residuais das mixed (as 3 "sem sinal" já estavam assim; ficam registradas como decididas).
  ('realistic-breasts', 'Realistic Breasts', false, false, null, true, false, 'D3: descreve o desenho do corpo (sinal fraco)'),
  ('big-breasted-female-lead', 'Big-Breasted Female Lead', false, false, null, false, false, 'traço de personagem: sem sinal de gate'),
  ('condom-s', 'Condom/s', false, false, null, true, false, 'objeto de contexto sexual (sinal fraco)'),
  ('blindfold', 'Blindfold', false, false, null, false, false, 'objeto ambíguo: sem sinal de gate'),
  ('asphyxiation', 'Asphyxiation', false, false, null, false, false, 'ambígua (violência ou prática): sem sinal de gate');

drop table if exists pg_temp.mig210_falsas;
create temp table mig210_falsas (slug text primary key, name text not null) on commit drop;
insert into mig210_falsas values
  ('mouse-girl-s', 'Mouse Girl/s'), ('prehistoric-ambience', 'Prehistoric Ambience'),
  ('rabbitbeast-s', 'Rabbitbeast/s'), ('catbeast-s', 'Catbeast/s');

-- destino NULL = alias removido
drop table if exists pg_temp.mig210_aliases;
create temp table mig210_aliases (alias_slug text primary key, destino_antes text not null, destino_depois text) on commit drop;
insert into mig210_aliases values
  ('smut', 'sexual-content', 'smut'),
  ('hentai', 'sexual-content', 'hentai'),
  ('ecchi', 'sexual-content', 'ecchi'),
  ('erotica', 'sexual-content', 'erotica'),
  ('mature', 'adult', 'mature'),
  ('nakadashi', 'condom-s', 'nakadashi-creampie'),
  ('orgy', 'gangbang', 'orgy-ies'),
  ('multiple-sexual-partners', 'gangbang', null),
  ('urination', 'squirting', null),
  ('exhibitionism', 'public-sex', null),
  ('rimjob', 'anal-sex', null),
  ('r15', 'r15-but-based-on-a-r19-novel', null),
  -- Consolidação (Ana, 2026-10-10): alias só quando os dois termos significam essencialmente a MESMA
  -- coisa. Os 14 abaixo ligam conceitos RELACIONADOS → removidos (a string vira tag própria e passa
  -- pelo enriquecimento). Nenhum destino novo é criado.
  ('submission', 'bdsm', null),
  ('spanking', 'whipping', null),
  ('dubious-consent', 'sexual-abuse', null),
  ('choking', 'asphyxiation', null),
  ('erotic-asphyxiation', 'asphyxiation', null),
  ('erotic-torture', 'torture', null),
  ('abuse', 'physical-abuse', null),
  ('child-abuse', 'physical-abuse', null),
  ('stockings', 'fetish-es', null),
  ('tail-plug', 'fetish-es', null),
  ('nipple-piercing-s', 'nipples', null),
  ('nipple-play', 'nipples', null),
  ('sex-friends-become-lovers', 'friends-become-lovers', null),
  ('sexual-curiosity', 'sexual-teasing', null),
  -- Checagem final (Ana, 2026-10-10): os 2 aliases de sentido INVERTIDO saem, sem destino novo.
  --   · "English Company Added Censorship" (a edição inglesa foi CENSURADA) virava "Uncensored Version
  --     Available": afirmava uma edição sem censura que a fonte não afirmou. Até a 205 o mesmo alias ia
  --     para "R19 disponível" — hoje o destino tem 0 vínculos, então o efeito é só na ingestão futura.
  --   · "Abused Family Member/s" (VÍTIMA na família) virava "Abusive Family Member/s" (AGRESSOR).
  ('english-company-added-censorship', 'uncensored-version-available', null),
  ('abused-family-member-s', 'abusive-family-member-s', null);

-- ── 1) Guardas de ENTRADA ──────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_orig int; n_novo int; n_tags int;
begin
  select count(*) into n_tags from mig210_tags;
  if not exists (select 1 from public.tag_group where slug = 'content_indicator') then
    raise exception 'mig 210: grupo content_indicator não existe; abortando';
  end if;

  -- Todas existem com o NOME esperado e o piso esperado (o piso não é tocado: mudou, a premissa caiu).
  select count(*) into n from public.tags t join mig210_tags c on c.slug = t.slug and c.name = t.name
   where t.adult_score_tier is not distinct from c.tier;
  if n <> n_tags then raise exception 'mig 210: esperava as % tags (slug + nome + piso), casaram %; abortando', n_tags, n; end if;

  -- Estado inteiro ORIGINAL (1ª execução) ou inteiro APLICADO (re-execução). Mistura = alguém mexeu à mão.
  select count(*) filter (where t.adult_indicator = c.ind_antes and t.adult_indicator_strong = c.strong_antes),
         count(*) filter (where t.adult_indicator = c.ind_depois and t.adult_indicator_strong = c.strong_depois)
    into n_orig, n_novo from public.tags t join mig210_tags c using (slug);
  if n_orig <> n_tags and n_novo <> n_tags then
    raise exception 'mig 210: estado misto das % tags (% originais, % aplicadas); conferir à mão; abortando', n_tags, n_orig, n_novo;
  end if;

  -- As 4 de 08/10: com o nome esperado, criadas naquele minuto, sem sinal 18+, piso nem subgrupo.
  select count(*) into n from public.tags t join mig210_falsas f on f.slug = t.slug and f.name = t.name
   where t.created_at >= '2026-10-08 06:15:00+00' and t.created_at < '2026-10-08 06:16:00+00'
     and not t.adult_indicator and not t.adult_indicator_strong and t.adult_score_tier is null
     and t.tag_subgroup_id is null;
  if n <> 4 then raise exception 'mig 210: esperava as 4 tags de 2026-10-08 06:15 sem sinal/piso/subgrupo, casaram %; abortando', n; end if;

  select count(*) into n from mig210_aliases a
   where a.destino_depois is not null and a.destino_depois <> 'mature'
     and not exists (select 1 from public.tags t where t.slug = a.destino_depois);
  if n > 0 then raise exception 'mig 210: % destino(s) de alias não existem; abortando', n; end if;

  -- Cada alias está no destino ANTIGO ou no NOVO. Qualquer outro lugar = mudou depois da medição.
  select count(*) into n from mig210_aliases a
    left join public.tag_alias x on x.alias_slug = a.alias_slug
    left join public.tags t on t.id = x.canonical_tag_id
   where not (t.slug is not distinct from a.destino_antes or t.slug is not distinct from a.destino_depois);
  if n > 0 then raise exception 'mig 210: % alias(es) fora do destino antigo e do novo; abortando', n; end if;

  select count(*) into n from public.tags t
   where t.slug = 'mature' and (t.name <> 'Mature' or t.adult_indicator or t.adult_indicator_strong or t.adult_score_tier is not null);
  if n > 0 then raise exception 'mig 210: já existe uma tag "mature" diferente da que esta migration criaria; abortando'; end if;
end
$guarda$;

-- ── 2) Proveniência do enriquecimento (schema) ──────────────────────────────────────────────
-- `default 'legacy'` primeiro: preenche as que JÁ existem; depois o default vira 'pending' para as novas.
alter table public.tags add column if not exists enrichment_status text not null default 'legacy';
alter table public.tags alter column enrichment_status set default 'pending';
alter table public.tags add column if not exists enrichment_at timestamptz;
alter table public.tags add column if not exists enrichment_detail text;
do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'tags_enrichment_status_check') then
    alter table public.tags add constraint tags_enrichment_status_check check (enrichment_status in
      ('pending', 'done', 'partial', 'provider_not_called', 'provider_failed', 'legacy', 'curated'));
  end if;
end
$ck$;
comment on column public.tags.enrichment_status is
  'Desfecho do enriquecimento automático (lib/tags/enrichment-status.ts): pending = criada, sem resultado; '
  'done = o modelo respondeu sobre ESTA tag; partial = respondeu, mas não sobre ela; provider_not_called = '
  'sem chave ou guard de proveniência; provider_failed = a chamada falhou; curated = decidida por curadoria/'
  'migration; legacy = anterior à migration 210, sem proveniência. Só done grava adult_score_tier_reviewed_at.';

-- ── 3) Retratos de ANTES (guardas de saída) e backup para o rollback ──────────────────────
drop table if exists pg_temp.mig210_works_antes_t;
create temp table mig210_works_antes_t on commit drop as
  select id, adult_auto, adult_reason, adult_override, edition_state, r19_edition, is_adult from public.works;
drop table if exists pg_temp.mig210_hashes;
create temp table mig210_hashes on commit drop as select
  (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) cs,
  (select md5(coalesce(string_agg(concat_ws('|', work_id, tag_id, source, confidence), ',' order by work_id, tag_id), '')) from public.work_tags) wt,
  (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) es,
  (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, adult_score_tier_reviewed_at, marks_r19_edition, origin, reviewed_at), ',' order by slug), ''))
     from public.tags where slug not in (select slug from mig210_tags union all select slug from mig210_falsas union all select 'mature')) tags_fora;

create schema if not exists bkp;
create table if not exists bkp.mig210_tags_antes (
  slug text primary key, name text not null, tag_group_id uuid, adult_indicator boolean not null,
  adult_indicator_strong boolean not null, adult_score_tier_reviewed_at timestamptz,
  existia boolean not null default true, salvo_em timestamptz not null default now()
);
create table if not exists bkp.mig210_alias_antes (
  alias_slug text primary key, destino_slug text, salvo_em timestamptz not null default now()
);
create table if not exists bkp.mig210_works_antes (
  work_id uuid primary key, adult_auto boolean not null, adult_reason text,
  adult_auto_depois boolean not null, adult_reason_depois text, causa text not null,
  salvo_em timestamptz not null default now()
);
comment on table bkp.mig210_tags_antes is 'mig 210: estado das tags tocadas ANTES (as do gate, as 4 falsamente avaliadas e "mature", que não existia). Usado por scripts/rollback/210_rollback.sql.';
comment on table bkp.mig210_alias_antes is 'mig 210: destino de cada alias tocado ANTES (NULL = não existia). Usado pelo rollback.';
comment on table bkp.mig210_works_antes is 'mig 210: adult_auto/adult_reason das obras recalculadas pela regra nova (≥1 tag forte), antes e depois, com a causa. Usado pelo rollback.';

insert into bkp.mig210_tags_antes (slug, name, tag_group_id, adult_indicator, adult_indicator_strong, adult_score_tier_reviewed_at)
select t.slug, t.name, t.tag_group_id, t.adult_indicator, t.adult_indicator_strong, t.adult_score_tier_reviewed_at
  from public.tags t where t.slug in (select slug from mig210_tags union all select slug from mig210_falsas)
on conflict (slug) do nothing;
insert into bkp.mig210_tags_antes (slug, name, adult_indicator, adult_indicator_strong, existia)
select 'mature', 'Mature', false, false, false
 where not exists (select 1 from public.tags where slug = 'mature')
on conflict (slug) do nothing;
insert into bkp.mig210_alias_antes (alias_slug, destino_slug)
select a.alias_slug, t.slug from mig210_aliases a
  left join public.tag_alias x on x.alias_slug = a.alias_slug left join public.tags t on t.id = x.canonical_tag_id
on conflict (alias_slug) do nothing;

-- ── 4) O PLANO: a regra nova (≥ 1 tag forte) aplicada a toda obra em que ela difere do gravado ──
-- Mesma decisão de `decideAdultAuto` (lib/tags/adult-classify.ts). A nota NÃO é lida.
drop table if exists pg_temp.mig210_plano;
create temp table mig210_plano on commit drop as
with sinais as (
  select w.id, w.adult_auto, w.adult_reason,
    -- DEPOIS: tag do conjunto pela flag decidida; as outras pela flag atual.
    coalesce(bool_or(coalesce(c.strong_depois, t.adult_indicator_strong)), false) as forte_depois,
    -- ANTES: só para classificar a CAUSA (pelas flags declaradas, independe de já ter rodado).
    coalesce(bool_or(coalesce(c.strong_antes, t.adult_indicator_strong)), false) as forte_antes,
    coalesce(bool_or(c.slug is not null and c.strong_depois and not c.strong_antes), false) as forte_nova_210
  from public.works w
  left join public.work_tags wt on wt.work_id = w.id
  left join public.tags t on t.id = wt.tag_id
  left join mig210_tags c on c.slug = t.slug
  group by w.id, w.adult_auto, w.adult_reason
),
d as (
  select s.*,
    case
      when coalesce(s.adult_reason, '') = 'ai_review' then null
      when s.forte_depois and not (s.adult_auto and s.adult_reason = 'tag_explicit') then 'liga'
      when not s.forte_depois and s.adult_auto and s.adult_reason in ('tag_explicit', 'tag_soft_score') then 'desliga'
    end as acao
  from sinais s
)
select id, adult_auto as auto_antes, adult_reason as motivo_antes,
       (acao = 'liga') as auto_depois,
       case when acao = 'liga' then 'tag_explicit' end as motivo_depois,
       case
         when acao = 'desliga' and adult_reason = 'tag_soft_score' then 'regra removida: tag fraca + nota não liga mais'
         when acao = 'desliga' and forte_antes then 'tag forte rebaixada pela 210'
         when acao = 'desliga' then 'deriva anterior: adult_auto por tag sem nenhuma tag forte'
         when acao = 'liga' and forte_nova_210 and not forte_antes then 'tag virou forte pela 210'
         when acao = 'liga' and adult_auto and adult_reason = 'tag_soft_score' then 'só troca o motivo (já tinha tag forte)'
         else 'deriva anterior: tag forte presente sem adult_auto'
       end as causa
  from d where acao is not null;

do $guarda$
declare n int;
begin
  select count(*) into n from mig210_plano;
  -- Medido no retrato da nuvem (2026-10-10). Muito maior = o banco mudou sem medição.
  if n > 60 then raise exception 'mig 210: o plano recalcularia % obras (medido: 47 em 2026-10-10) — remedir antes; abortando', n; end if;
end
$guarda$;

-- ── 5) Aplicar ──────────────────────────────────────────────────────────────────────────────
insert into bkp.mig210_works_antes (work_id, adult_auto, adult_reason, adult_auto_depois, adult_reason_depois, causa)
select id, auto_antes, motivo_antes, auto_depois, motivo_depois, causa from mig210_plano
on conflict (work_id) do nothing;

update public.tags t
   set adult_indicator = c.ind_depois, adult_indicator_strong = c.strong_depois,
       enrichment_status = 'curated', enrichment_at = coalesce(t.enrichment_at, now()),
       enrichment_detail = 'mig 210: ' || c.motivo
  from mig210_tags c
 where t.slug = c.slug
   and (t.adult_indicator, t.adult_indicator_strong, t.enrichment_status) is distinct from (c.ind_depois, c.strong_depois, 'curated');

update public.tags t
   set tag_group_id = null, adult_score_tier_reviewed_at = null,
       enrichment_status = 'provider_not_called', enrichment_at = coalesce(t.enrichment_at, now()),
       enrichment_detail = 'mig 210: nenhuma chamada de IA no log (classificador nem enricher) em 2026-10-08 06:15; '
                        || 'o grupo other era fallback e a marca de revisão era falsa'
  from mig210_falsas f
 where t.slug = f.slug and t.enrichment_status is distinct from 'provider_not_called';

insert into public.tags (slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong,
                         origin, reviewed_at, adult_score_tier_reviewed_at, enrichment_status, enrichment_at, enrichment_detail)
select 'mature', 'Mature', g.id, s.id, false, false, 'manual', now(), now(), 'curated', now(),
       'mig 210: rótulo editorial (cobre violência sem sexo, como a mig 166 já dizia); NÃO é sinal 18+ nem piso'
  from public.tag_group g left join public.tag_subgroup s on s.tag_group_id = g.id and s.name = 'Rating Labels'
 where g.slug = 'content_indicator'
on conflict (slug) do nothing;

delete from public.tag_alias x using mig210_aliases a
 where x.alias_slug = a.alias_slug and a.destino_depois is null;
insert into public.tag_alias (alias_slug, canonical_tag_id)
select a.alias_slug, t.id from mig210_aliases a join public.tags t on t.slug = a.destino_depois
on conflict (alias_slug) do update set canonical_tag_id = excluded.canonical_tag_id
 where public.tag_alias.canonical_tag_id is distinct from excluded.canonical_tag_id;

update public.works w set adult_auto = p.auto_depois, adult_reason = p.motivo_depois
  from mig210_plano p where w.id = p.id;

-- ── 6) Guardas de SAÍDA ─────────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_ovr int; n_es int; n_r19 int; h record;
begin
  select count(*) into n from public.tags t join mig210_tags c using (slug)
   where (t.adult_indicator, t.adult_indicator_strong) is distinct from (c.ind_depois, c.strong_depois)
      or t.adult_score_tier is distinct from c.tier;
  if n > 0 then raise exception 'mig 210: % tag(s) fora do estado decidido (ou com o piso mexido)', n; end if;

  select count(*) into n from mig210_aliases a
    left join public.tag_alias x on x.alias_slug = a.alias_slug left join public.tags t on t.id = x.canonical_tag_id
   where t.slug is distinct from a.destino_depois;
  if n > 0 then raise exception 'mig 210: % alias(es) fora do destino decidido', n; end if;

  select count(*) into n from public.tags t join mig210_falsas f using (slug)
   where t.tag_group_id is not null or t.adult_score_tier_reviewed_at is not null or t.enrichment_status <> 'provider_not_called';
  if n > 0 then raise exception 'mig 210: % das 4 tags de 08/10 ainda com cara de avaliadas', n; end if;

  -- A regra nova vale para TODA obra depois daqui (salvo ai_review): nenhuma divergência sobra.
  select count(*) into n from public.works w
   where coalesce(w.adult_reason, '') <> 'ai_review'
     and (w.adult_auto is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                                                 where wt.work_id = w.id and t.adult_indicator_strong));
  if n > 0 then raise exception 'mig 210: % obra(s) com adult_auto fora da regra (≥1 tag forte)', n; end if;

  select count(*) into n from mig210_works_antes_t a join public.works w on w.id = a.id
   where (w.adult_auto, w.adult_reason) is distinct from (a.adult_auto, a.adult_reason)
     and a.id not in (select id from mig210_plano);
  if n > 0 then raise exception 'mig 210: % obra(s) FORA do plano mudaram de adult_auto/adult_reason', n; end if;

  select count(*) filter (where w.adult_override is distinct from a.adult_override),
         count(*) filter (where w.edition_state is distinct from a.edition_state),
         count(*) filter (where w.r19_edition is distinct from a.r19_edition)
    into n_ovr, n_es, n_r19 from mig210_works_antes_t a join public.works w on w.id = a.id;
  if n_ovr > 0 or n_es > 0 or n_r19 > 0 then
    raise exception 'mig 210: mexeu em override (%), edition_state (%) ou r19_edition (%)', n_ovr, n_es, n_r19;
  end if;

  select * into h from mig210_hashes;
  if h.cs is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) then
    raise exception 'mig 210: category_scores mudou — esta migration não pode tocar nota';
  end if;
  if h.wt is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, tag_id, source, confidence), ',' order by work_id, tag_id), '')) from public.work_tags) then
    raise exception 'mig 210: work_tags mudou — esta migration não pode tocar vínculo';
  end if;
  if h.es is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) then
    raise exception 'mig 210: work_edition_state mudou';
  end if;
  if h.tags_fora is distinct from (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, adult_score_tier_reviewed_at, marks_r19_edition, origin, reviewed_at), ',' order by slug), ''))
       from public.tags where slug not in (select slug from mig210_tags union all select slug from mig210_falsas union all select 'mature')) then
    raise exception 'mig 210: uma tag FORA dos conjuntos mudou';
  end if;

  raise notice 'mig 210: % tags · 4 tags de 08/10 · % alias(es) · obras recalculadas % · is_adult: % entram, % saem',
    (select count(*) from mig210_tags), (select count(*) from mig210_aliases), (select count(*) from mig210_plano),
    (select count(*) from mig210_works_antes_t a join public.works w on w.id = a.id where not a.is_adult and w.is_adult),
    (select count(*) from mig210_works_antes_t a join public.works w on w.id = a.id where a.is_adult and not w.is_adult);
end
$guarda$;
