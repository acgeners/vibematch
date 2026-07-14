-- 154 — `works` perde as 19 colunas pessoais. O espelho (`user_work_state`) vira a única fonte.
--
-- Fecha a Fase 2 (multi-user). Pré-requisitos, todos já em main:
--   Fase D  (PR #146) — o dono passa a LER o espelho pela view `works_owner`
--   Fase D2 (PR #147) — as leituras do dono saem de `works`; a view para de ler a tabela
--   Fase E  (PR #148) — `works` para de RECEBER escrita pessoal
--
-- Provado antes de escrever isto (via Management API, contra o banco real):
--   · 882 obras × 882 linhas no espelho
--   · 0 obras com dado pessoal em `works` sem linha no espelho  → nada se perde
--   · 0 divergências de valor entre `works` e o espelho          → nada se sobrescreve
--   · `works_owner` tem 0 dependências reais (pg_depend) nas colunas abaixo — ela já lê o espelho,
--     então o DROP não a derruba nem exige CASCADE.
--
-- Rollback: `works_snapshot_20260713` (882 linhas, as 19 colunas) e o dump NDJSON em .backups/.

begin;

-- 1) O TRIGGER PRIMEIRO — senão ele vira uma mina.
--
-- `enforce_total_chapters_gte_read` tem corpo PL/pgSQL (string), e corpo em string NÃO registra
-- dependência de coluna no pg_depend. O DROP abaixo passaria sem tocá-lo, e como ele é
-- BEFORE INSERT (a lista de colunas só restringe o UPDATE), o próximo cadastro de obra morreria com
--   ERROR 42703: record "new" has no field "chapters_read"
--
-- Ele também não deve ser recriado no espelho: o que ele fazia era empurrar `works.total_chapters`
-- (catálogo COMPARTILHADO) pra cima até o `chapters_read` de UMA pessoa. Ou seja, o progresso de
-- leitura de um usuário reescrevia o catálogo de todos — a mesma classe de vazamento que a Fase E
-- fechou. Desde a Fase E nada mais escreve `chapters_read` em `works`, então ele já está inerte.
drop trigger if exists trg_enforce_total_chapters_gte_read on public.works;
drop function if exists public.enforce_total_chapters_gte_read();

-- 2) As 19 colunas. Os 13 check/FK constraints e os 2 índices (works_is_favorite_idx,
--    works_last_read_at_idx) caem junto com suas colunas — não precisam de linha própria.
alter table public.works
  drop column if exists is_favorite,
  drop column if exists personal_status_id,
  drop column if exists chapters_read,
  drop column if exists last_read_at,
  drop column if exists user_score,
  drop column if exists observation_adjustment,
  drop column if exists observations,
  drop column if exists synopsis_quality,
  drop column if exists synopsis_quality_source,
  drop column if exists synopsis_quality_prediction_id,
  drop column if exists synopsis_interest_skipped,
  drop column if exists post_story_score,
  drop column if exists post_fl_score,
  drop column if exists post_ml_score,
  drop column if exists post_character_development_score,
  drop column if exists post_pacing_score,
  drop column if exists post_art_visual_score,
  drop column if exists post_impact_immersion_score,
  drop column if exists post_originality_score;

commit;
