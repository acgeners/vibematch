-- 179 — Aposenta a proveniência 'legacy_unknown' do Interesse manual.
--
-- MOTIVO: `legacy_unknown` carregava DUAS coisas que não têm relação entre si, e a
-- confusão era visível no dado (medido no banco, 971 obras do dono):
--   • 296 linhas COM ♥ — valores anteriores à migration 108, que carimbou tudo que já
--     existia como "não inferir". Têm nota; só não se registrou a origem.
--   • 133 linhas SEM ♥ — aqui a string não descreve nada: é só o DEFAULT da coluna.
--     Toda linha nascia assim, e limpar o ♥ gravava isso de volta.
-- O filtro "Desconhecido" da UI casava pela string e juntava os dois grupos num balde só.
--
-- REGRA NOVA: ou tem ♥ ou não tem; se tem, a origem só importa quando veio da PREVISÃO.
--   ♥ + origem humana/legada → 'human_manual'
--   ♥ aplicado da previsão   → 'prediction_applied'  (inalterado)
--   sem ♥                    → sem proveniência (NULL)
--
-- Nenhum ♥ é criado, alterado ou apagado — só o rótulo de origem.
--
-- ⚠️ ORDEM: esta migration vem ANTES do deploy do código. O código novo grava NULL na
-- coluna, e NULL é rejeitado enquanto ela for NOT NULL.

begin;

-- ── 1. Dados ────────────────────────────────────────────────────────────────────
-- Primeiro solta o NOT NULL/default: o update abaixo grava NULL.
alter table user_work_state
  alter column synopsis_quality_source drop default,
  alter column synopsis_quality_source drop not null;

update user_work_state
   set synopsis_quality_source = 'human_manual'
 where synopsis_quality_source = 'legacy_unknown'
   and synopsis_quality is not null;

update user_work_state
   set synopsis_quality_source = null
 where synopsis_quality_source = 'legacy_unknown'
   and synopsis_quality is null;

-- ── 2. Schema ───────────────────────────────────────────────────────────────────
alter table user_work_state
  drop constraint if exists user_work_state_synopsis_quality_source_check;

alter table user_work_state
  add constraint user_work_state_synopsis_quality_source_check
  check (synopsis_quality_source is null
         or synopsis_quality_source in ('human_manual', 'prediction_applied'));

-- 🔴 É ESTE constraint que impede o conceito de voltar. Sem ele, "origem sem valor"
-- (ou "valor sem origem") volta a ser legal e reaparece pela porta do INSERT que
-- omite a coluna — que foi exatamente como o legacy_unknown se espalhou.
alter table user_work_state
  drop constraint if exists user_work_state_quality_source_coerente;

alter table user_work_state
  add constraint user_work_state_quality_source_coerente
  check ((synopsis_quality is null) = (synopsis_quality_source is null));

comment on column user_work_state.synopsis_quality_source is
  'Origem do ♥ manual: human_manual (o usuário pontuou) | prediction_applied (cópia da previsão IA via Aplicar) | NULL (não há ♥, logo não há origem). NÃO afeta score/ranking. A migration 179 aposentou legacy_unknown.';

-- ── 3. View works_owner ─────────────────────────────────────────────────────────
-- O coalesce injetava 'legacy_unknown' de volta em toda obra sem linha de estado —
-- ou seja, a view recriava o conceito mesmo depois de a tabela ficar limpa.
create or replace view works_owner as
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
    w.cascade_status
   FROM works w
     LEFT JOIN user_work_state s ON s.work_id = w.id AND s.user_id = (( SELECT user_settings.current_user_id
           FROM user_settings
          ORDER BY user_settings.created_at
         LIMIT 1));

commit;
