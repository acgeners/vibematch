-- 143_user_work_state_rebackfill.sql
-- Fase 2 / FATIA 1 (PLANO-MULTIUSER-FASE2.md §13.2, passo 1).
--
-- Re-backfill de `user_work_state` a partir de `works`, NO MOMENTO DO CORTE.
--
-- Por que: a mig 138 criou a tabela e a preencheu, mas **nada escreveu nela desde então**
-- (nenhum writer, nenhum reader). As 878 linhas de lá estão VELHAS. A partir desta fatia, o
-- estado de LEITURA passa a ser lido de `user_work_state` — então ele precisa estar igual a
-- `works` no instante em que o rewire entra, senão a virada "perde" capítulos e favoritos do
-- dono em silêncio (que é o pior modo de falha deste projeto: erra e produz resultado).
--
-- Dono = linha singleton de `user_settings` (a mais antiga). Todo o estado que existe hoje em
-- `works` é dele — `works` NÃO tem coluna de dono, é a linha compartilhada do catálogo.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ O QUE FICA VIVO E O QUE VIRA FOTOGRAFIA
--
-- A Fatia 1 move só o estado de LEITURA. Depois desta migration:
--
--   is_favorite, personal_status_id, chapters_read, last_read_at
--     → DUAL-WRITE ligado. `user_work_state` é a fonte de verdade por usuário; a coluna
--       equivalente em `works` segue como espelho **do dono** (e só dele).
--
--   user_score, observation_adjustment, observations, synopsis_quality*, post_*_score
--     → FOTOGRAFIA. Ninguém escreve nem lê estas colunas em `user_work_state`. Elas são um
--       retrato de `works` na data do corte e **vão ficando velhas** conforme o dono edita
--       notas. NÃO CONFIE NELAS. A Fatia 2 (scoring per-user) re-backfilla antes de usá-las.
--
-- Nenhuma coluna de `works` é dropada aqui — nem nesta fatia (§13.4): o projeto está no Free,
-- sem backup de schema, e `DROP COLUMN` é a única operação sem volta da fatia. O custo de
-- adiar é zero.
-- ─────────────────────────────────────────────────────────────────────────────────────────
--
-- Idempotente: pode rodar quantas vezes quiser. Roda em SQL (`insert … select`), então NÃO
-- sofre o corte de 1000 linhas do PostgREST — esse teto é do `select` da API, não do Postgres.
-- (O equivalente em JS — `scripts/rebackfill-user-work-state.mjs` — pagina, justamente por isso.)
--
-- ⚠️ TIPO DIFERENTE NOS DOIS LADOS: `works.last_read_at` é **date**; a coluna espelho aqui é
-- **timestamptz** (assim nasceu na mig 138). A mesma data volta da API como
-- "2025-02-03T00:00:00+00:00" em vez de "2025-02-03" — e meia-noite UTC, lida no fuso do
-- Brasil (UTC-3), é o DIA ANTERIOR. Quem lê esta coluna normaliza para o dia
-- (`personalStateFromRow()` em server/queries/user-work-state.ts); sem isso, o rewire das
-- leituras teria empurrado toda "última leitura" um dia pra trás, em silêncio. Alinhar o tipo
-- (`alter column last_read_at type date`) é seguro — todos os valores são 00:00:00+00 — mas
-- fica pra depois: o código já normaliza, e schema change não é pré-requisito desta fatia.
--
-- Aplicar à mão no SQL editor do Supabase.

insert into public.user_work_state (
  user_id, work_id,
  is_favorite, personal_status_id, chapters_read, last_read_at,
  user_score, observation_adjustment, observations,
  synopsis_quality, synopsis_quality_source, synopsis_quality_prediction_id, synopsis_interest_skipped,
  post_story_score, post_fl_score, post_ml_score, post_character_development_score,
  post_pacing_score, post_art_visual_score, post_impact_immersion_score, post_originality_score,
  updated_at
)
select
  (select current_user_id from public.user_settings order by created_at asc limit 1),
  w.id,
  coalesce(w.is_favorite, false), w.personal_status_id, w.chapters_read, w.last_read_at,
  w.user_score, coalesce(w.observation_adjustment, 0), w.observations,
  w.synopsis_quality, coalesce(w.synopsis_quality_source, 'legacy_unknown'),
  w.synopsis_quality_prediction_id, coalesce(w.synopsis_interest_skipped, false),
  w.post_story_score, w.post_fl_score, w.post_ml_score, w.post_character_development_score,
  w.post_pacing_score, w.post_art_visual_score, w.post_impact_immersion_score, w.post_originality_score,
  now()
from public.works w
on conflict (user_id, work_id) do update set
  -- Estado de leitura: o que a Fatia 1 passa a ler daqui.
  is_favorite        = excluded.is_favorite,
  personal_status_id = excluded.personal_status_id,
  chapters_read      = excluded.chapters_read,
  last_read_at       = excluded.last_read_at,
  -- Fotografia (ver o aviso no topo): atualizada agora, congelada depois.
  user_score                       = excluded.user_score,
  observation_adjustment           = excluded.observation_adjustment,
  observations                     = excluded.observations,
  synopsis_quality                 = excluded.synopsis_quality,
  synopsis_quality_source          = excluded.synopsis_quality_source,
  synopsis_quality_prediction_id   = excluded.synopsis_quality_prediction_id,
  synopsis_interest_skipped        = excluded.synopsis_interest_skipped,
  post_story_score                 = excluded.post_story_score,
  post_fl_score                    = excluded.post_fl_score,
  post_ml_score                    = excluded.post_ml_score,
  post_character_development_score = excluded.post_character_development_score,
  post_pacing_score                = excluded.post_pacing_score,
  post_art_visual_score            = excluded.post_art_visual_score,
  post_impact_immersion_score      = excluded.post_impact_immersion_score,
  post_originality_score           = excluded.post_originality_score,
  updated_at                       = now();

-- Confere: uma linha do dono para cada obra. Deve devolver 0.
--   select count(*) from public.works w
--   where not exists (
--     select 1 from public.user_work_state s
--     where s.work_id = w.id
--       and s.user_id = (select current_user_id from public.user_settings order by created_at asc limit 1)
--   );

comment on table public.user_work_state is
  'Estado per-usuário-por-obra. FATIA 1 (mig 143): as 4 colunas de LEITURA (is_favorite, personal_status_id, chapters_read, last_read_at) são a FONTE DE VERDADE por usuário — os writers fazem dual-write aqui (sempre) e em works (só quando o usuário É o dono; works é a linha compartilhada). As colunas de nota/pós-leitura/interesse são uma FOTOGRAFIA do corte da Fatia 1: ninguém as lê nem as escreve, e elas envelhecem — a Fatia 2 re-backfilla antes de usá-las.';
