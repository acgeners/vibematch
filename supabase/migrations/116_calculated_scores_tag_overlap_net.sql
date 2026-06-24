-- 116 — Sinal de desempate dentro do tier: overlap de tags do perfil EFETIVO.
--
-- Persiste `lovedTagOverlap − avoidedTagOverlap` (perfil LLM + preferências de tag
-- declaradas, já mescladas no recalc) como o sinal de desempate DENTRO do tier no
-- ranking, substituindo `personal_fit` nesse papel.
--
-- Motivação (auditoria 2026-06): sobre o catálogo fresco, `personal_fit` é quase
-- constante (std ~0.065) e ordena obras DENTRO do tier PIOR que o acaso
-- (acurácia pareada intra-tier ~0.4545). O overlap de tags ordena melhor
-- (~0.53–0.54) e varia. Aditiva, nullable — não quebra leituras antigas.
alter table calculated_scores
  add column if not exists tag_overlap_net numeric;

comment on column calculated_scores.tag_overlap_net is
  'lovedTagOverlap - avoidedTagOverlap (perfil efetivo: LLM + tags declaradas). Desempate dentro do tier no ranking (substitui personal_fit nesse papel). NULL = perfil sem loved/avoided ou pré-migration 116.';
