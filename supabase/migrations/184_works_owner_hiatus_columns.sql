-- ============================================================
-- 184 — works_owner passa a expor as colunas de hiato da 183
-- ============================================================
-- A view `works_owner` lista as colunas de `works` UMA A UMA, então coluna nova na tabela
-- nasce invisível para todo consumidor da view — sem erro, sem aviso, e sem nada que
-- denuncie. Foi o que aconteceu com as três da migration 183: a fila de curadoria
-- (`/ai-evaluation`, que lê `works_owner` porque precisa do status de leitura e da nota do
-- DONO) recebia `undefined` e mostrava o badge de hiato sem tipo, enquanto a mesma obra
-- aparecia qualificada em `/titles` e no `/ranking`.
--
-- ⚠️ Isto NÃO é específico do hiato. Toda coluna futura de `works` cai na mesma armadilha, e o
-- sintoma é sempre "a tela X não mostra o que a tela Y mostra" — caro de diagnosticar porque
-- nada erra, só falta. Quem adicionar coluna em `works` e quiser vê-la na console tem que
-- passar por aqui.
--
-- `create or replace view` exige que as colunas JÁ EXISTENTES mantenham nome, tipo e ordem;
-- por isso as três entram no FIM, depois de `cascade_status`. Reordenar o resto faria o
-- comando falhar (e é bom que falhe).
-- ============================================================

set lock_timeout = '5s';

create or replace view public.works_owner as
 SELECT w.id,
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
    COALESCE(s.is_favorite, false) AS is_favorite,
    s.personal_status_id,
    s.chapters_read,
    s.last_read_at,
    s.user_score,
    s.observations,
    COALESCE(s.observation_adjustment, 0::numeric) AS observation_adjustment,
    s.synopsis_quality,
    s.synopsis_quality_source,
    s.synopsis_quality_prediction_id,
    COALESCE(s.synopsis_interest_skipped, false) AS synopsis_interest_skipped,
    s.post_story_score,
    s.post_fl_score,
    s.post_ml_score,
    s.post_character_development_score,
    s.post_pacing_score,
    s.post_art_visual_score,
    s.post_impact_immersion_score,
    s.post_originality_score,
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
    w.cascade_status,
    -- migration 183 — catálogo, igual para todo mundo (não são colunas do espelho `s`)
    w.hiatus_kind,
    w.hiatus_kind_confidence,
    w.publication_status_note
   FROM works w
     LEFT JOIN user_work_state s ON s.work_id = w.id AND s.user_id = (( SELECT user_settings.current_user_id
           FROM user_settings
          ORDER BY user_settings.created_at
         LIMIT 1));
