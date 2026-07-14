-- 152_works_owner_view_completa.sql
-- A view `works_owner` (mig 150) nasceu INCOMPLETA — e isso já quebrou o app.
--
-- Ela expunha 34 das 49 colunas de `works`: as 15 de catálogo que faltavam simplesmente não
-- existiam nela. O contrato que a view PROMETE aos consumidores é "sou `works`, com as colunas
-- pessoais vindas do espelho do dono" — e quem confia nesse contrato e pede uma das 15 leva um
-- erro do PostgREST.
--
-- 🔴 Não é hipotético. DOIS consumidores que a Fase C (#143) já apontou pra view pedem
-- `review_summary`, que não está lá:
--
--   server/queries/deep-dive.ts        (getDeepDiveCandidate)
--   server/queries/recommendations.ts  (getFavoriteCandidates, via CANDIDATE_WORK_SELECT)
--
--   → "column works_owner.review_summary does not exist"
--
-- Ou seja: o deep dive e as candidatas-favoritas da recomendação estão quebrados na main desde
-- a mig 150. Conferido contra o banco, não deduzido do código.
--
-- ── Por que COMPLETAR a view, e não remendar os dois call sites ────────────────────────
--
-- Porque a próxima pessoa (ou eu, na Fase E) vai apontar mais um consumidor pra cá e cair no
-- mesmo buraco. Uma view que é "quase `works`" é uma armadilha: o erro não aparece na troca,
-- aparece na primeira vez que alguém pede a coluna que faltava. Completa, ela cumpre o contrato
-- e a troca `from("works")` → `from("works_owner")` passa a ser sempre segura.
--
-- As 15 que faltavam (todas de CATÁLOGO — vêm de `works`, não do espelho):
--   ai_eval_reviews_stale, canonical_synopsis_at, canonical_synopsis_inputs_hash,
--   cascade_status, chapters_checked_at, last_chapter_released_at, next_chapter_predicted_at,
--   review_digest, review_digest_at, review_digest_n, review_digest_version,
--   review_summary, review_summary_at, review_summary_inputs_hash, reviews_hash
--
-- ⚠️ `create or replace view` só deixa ACRESCENTAR coluna no fim da lista — não dá pra
-- reordenar nem mudar tipo. Por isso as 15 entram no fim, depois das pessoais. A ordem não
-- importa pra nenhum consumidor (todos pedem por nome), e assim os grants/revoke sobrevivem.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/152_works_owner_view_completa.sql

create or replace view public.works_owner as
select
  w.id,
  w.title,
  w.original_title,
  w.alternative_titles,
  w.year,
  w.year_end,
  w.total_chapters,
  w.publication_status_id,
  w.ai_eval_status,
  w.is_archived,
  w.canonical_synopsis,
  w.created_at,
  w.updated_at,
  w.data_refreshed_at,
  w.tags_inferred_at,

  -- ── As 19 pessoais: do ESPELHO DO DONO, não de `works`.
  coalesce(s.is_favorite, false)                        as is_favorite,
  s.personal_status_id,
  s.chapters_read,
  s.last_read_at,
  s.user_score,
  s.observations,
  coalesce(s.observation_adjustment, 0)                 as observation_adjustment,
  s.synopsis_quality,
  coalesce(s.synopsis_quality_source, 'legacy_unknown') as synopsis_quality_source,
  s.synopsis_quality_prediction_id,
  coalesce(s.synopsis_interest_skipped, false)          as synopsis_interest_skipped,
  s.post_story_score,
  s.post_fl_score,
  s.post_ml_score,
  s.post_character_development_score,
  s.post_pacing_score,
  s.post_art_visual_score,
  s.post_impact_immersion_score,
  s.post_originality_score,

  -- ── As 15 de CATÁLOGO que faltavam (vêm de `works`, como todo o resto do catálogo).
  w.canonical_synopsis_at,
  w.canonical_synopsis_inputs_hash,
  w.review_summary,
  w.review_summary_at,
  w.review_summary_inputs_hash,
  w.review_digest,
  w.review_digest_at,
  w.review_digest_n,
  w.review_digest_version,
  w.reviews_hash,
  w.ai_eval_reviews_stale,
  w.last_chapter_released_at,
  w.next_chapter_predicted_at,
  w.chapters_checked_at,
  w.cascade_status
from public.works w
left join public.user_work_state s
  on s.work_id = w.id
 and s.user_id = (select current_user_id from public.user_settings order by created_at asc limit 1);

-- `create or replace` preserva os grants, mas repetir o revoke é barato e não deixa a
-- segurança depender de eu ter lembrado. Um backup não pode virar vazamento; uma view também
-- não (`create view` NÃO herda RLS, e `public` é o schema que o PostgREST expõe).
revoke all on public.works_owner from anon, authenticated;

comment on view public.works_owner is
  'FASE C/D: `works` COMPLETA (as 49 colunas) com as 19 PESSOAIS vindas do espelho do DONO (user_work_state) em vez da linha compartilhada. Serve os consumidores do dado DO DONO — scoring, calibração, pesos, recomendação, deep dive, ledger, filas de curadoria — que trocam UMA PALAVRA (`from("works")` → `from("works_owner")`) em vez de reescrever o filtro à mão (reescrever é onde se erra em silêncio: um `.not(user_score is null)` sobre coluna vazia devolve ZERO linhas e a calibração "roda com sucesso" sobre nada). ⚠️ NÃO use nas queries voltadas ao USUÁRIO (/ranking, /leitura, /titles, home): elas servem qualquer pessoa e o estado pessoal delas tem que vir do espelho de QUEM OLHA, não do dono. NÃO é exposta pela API (revoke). Sobrevive ao DROP das colunas pessoais de works.';
