-- ============================================================
-- 108 — proveniência de works.synopsis_quality  [Plano 3, Fase B]
-- ============================================================
-- ADITIVA e NÃO-DESTRUTIVA. Diferencia a ORIGEM do valor manual de "Interesse
-- na Sinopse" (works.synopsis_quality), para que a análise exploratória saiba o
-- que é rótulo humano independente vs cópia da previsão IA (botão "Aplicar").
--
-- IMPORTANTE: NÃO altera o VALOR de synopsis_quality, nem o score, nem o ranking,
-- nem o gate de staleness, nem a tabela synopsis_quality_predictions. Só adiciona
-- a coluna de proveniência + o id da previsão de origem (quando aplicável).
--
-- Os 655 valores HISTÓRICOS ficam todos 'legacy_unknown' (default) — NÃO se tenta
-- inferir retrospectivamente quais eram humanos vs copiados (plano §1). Histórico
-- = exploratório, nunca golden principal. O golden vive separado (migration 109).
--
-- RLS já está ligado em works; estas colunas herdam. Numeração: 106 reservada
-- pela feat/shadow-ranking, 107 = ai_cache_events → esta é 108.
-- ============================================================

alter table works
  add column if not exists synopsis_quality_source text not null default 'legacy_unknown'
    check (synopsis_quality_source in ('legacy_unknown','human_manual','prediction_applied')),
  add column if not exists synopsis_quality_prediction_id uuid
    references synopsis_quality_predictions(id) on delete set null;

comment on column works.synopsis_quality_source is
  'Proveniência do valor manual de synopsis_quality (Plano 3): legacy_unknown (histórico, não inferir) | human_manual (informado/alterado direto pelo usuário) | prediction_applied (cópia da previsão IA via botão Aplicar). NÃO afeta score/ranking.';
comment on column works.synopsis_quality_prediction_id is
  'Quando synopsis_quality_source=prediction_applied: id da synopsis_quality_predictions de origem (auditoria). NULL nos demais casos.';
