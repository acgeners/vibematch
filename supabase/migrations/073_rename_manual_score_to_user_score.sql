-- Fase 1.5.0: renomeia works.manual_score → works.user_score
-- Mudança puramente semântica: o cálculo continua sendo a média ponderada dos
-- 8 critérios de avaliação (história, originalidade, arte, etc.) feita no
-- work-status-form. O nome novo deixa claro que é a "nota do user" (input
-- do user pós-leitura) em vez de "manual score" (que sugeria input direto).
--
-- Coerente com a refatoração de naming: "Atributos da obra" (9 da IA,
-- descritivos) vs "Critérios de avaliação" (8 do user, qualitativos que
-- geram a user_score).

ALTER TABLE works RENAME COLUMN manual_score TO user_score;
