-- ============================================================
-- 171 — user_work_state.quick_score (nota rápida do onboarding)
-- ============================================================
-- Decisão travada em 2026-07-28 (onboarding): não existe "nota única" no app —
-- `user_score` é DERIVADO (média dos 7 eixos de gosto, ou dos 8 craft) e só grava
-- com a ficha completa. O onboarding precisa de uma nota de 1 toque (0–10) pra
-- obra que a pessoa marca "já li" no deck.
--
-- PRECEDÊNCIA (padrão COALESCE, igual works.is_adult = coalesce(override, auto)):
-- a FICHA COMPLETA SEMPRE VENCE a nota rápida. Implementação: `quick_score` é a
-- coluna própria; o rótulo efetivo continua sendo `user_score` — a action
-- `saveQuickScore` só escreve `user_score = quick_score` quando NÃO existe ficha
-- (nenhum craft preenchido e gosto incompleto), e a ficha, ao completar, SOBRESCREVE
-- `user_score` (caminhos existentes). Nenhum leitor do rótulo muda.
--
-- A coluna fica em `user_work_state` (per-user desde a 138; RLS da 142 já cobre
-- todas as colunas da linha — nada de política nova).
-- ============================================================

set lock_timeout = '5s';

alter table public.user_work_state add column if not exists quick_score numeric(3,1)
  constraint user_work_state_quick_score_range
  check (quick_score is null or (quick_score >= 0 and quick_score <= 10));

comment on column public.user_work_state.quick_score is
  'Nota rápida 0–10 (onboarding/1 toque). NÃO é o rótulo: user_score continua sendo o rótulo efetivo — saveQuickScore faz o write-through quando não há ficha, e a ficha completa sempre vence (COALESCE por precedência de escrita). Ver lib/onboarding/quick-score-precedence.ts.';
