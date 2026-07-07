-- ============================================================
-- 133 — pilot_taste_scores — coleta do PILOTO de "notas de gosto" (gosto segmentado)
-- ============================================================
-- Throwaway/experimento (Fase 3 do PLANO-ARQUITETURA-NOTAS.md). 1 linha por obra
-- já lida (com user_score). 6 eixos de gosto + "Gostei geral", na mesma escala dos
-- pós-leitura de craft: {2, 4, 6.5, 8, 10} (★–★★★★★) ou NULL = ainda não avaliado.
--
-- N/A do Final: `ending_na=true` distingue "não se aplica" (obra em andamento) de
-- "ainda não notei" — ambos deixam like_ending_score NULL.
--
-- Critérios registrados em criteria (eval_type='Gosto', slugs taste_*, keys like_*_score).
-- Sem pesos (o "Gostei geral" é dado direto; os aspectos serão pesados por regressão
-- na Fase 4). Single-user (work_id é PK) — coerente com o modelo atual.
-- ============================================================

create table if not exists pilot_taste_scores (
  work_id uuid primary key references works(id) on delete cascade,
  like_leads_score    numeric(3,1) check (like_leads_score    is null or like_leads_score    in (2, 4, 6.5, 8, 10)),
  like_setting_score  numeric(3,1) check (like_setting_score  is null or like_setting_score  in (2, 4, 6.5, 8, 10)),
  like_tone_score     numeric(3,1) check (like_tone_score     is null or like_tone_score     in (2, 4, 6.5, 8, 10)),
  like_art_score      numeric(3,1) check (like_art_score      is null or like_art_score      in (2, 4, 6.5, 8, 10)),
  like_pacing_score   numeric(3,1) check (like_pacing_score   is null or like_pacing_score   in (2, 4, 6.5, 8, 10)),
  like_ending_score   numeric(3,1) check (like_ending_score   is null or like_ending_score   in (2, 4, 6.5, 8, 10)),
  like_overall_score  numeric(3,1) check (like_overall_score  is null or like_overall_score  in (2, 4, 6.5, 8, 10)),
  ending_na  boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table pilot_taste_scores is
  'Piloto do gosto segmentado (Fase 3). 1 linha/obra; 6 eixos + gostei geral; escala {2,4,6.5,8,10} ou NULL. Ver PLANO-ARQUITETURA-NOTAS.md.';
comment on column pilot_taste_scores.ending_na is
  'true = Final marcado "não se aplica" (obra em andamento). Distingue de NULL = ainda não avaliado.';

-- RLS ligada sem policy permissiva (padrão do projeto; service role faz bypass).
alter table pilot_taste_scores enable row level security;
