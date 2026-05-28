-- 063_criteria_rubric_calibration.sql
-- Calibra rubricas dos critérios IA pra reduzir vieses sistemáticos identificados
-- em avaliações reais (protagonist penalizado por crítica de qualidade,
-- couple_dynamics baixo em BDSM consensual, romance subplot em slow burn,
-- adult_content baixo com R19 sem corroboração).
-- Lembre de rodar `npm run sync-constants` após aplicar esta migration pra
-- regenerar lib/constants/criteria.ts.
-- Obs.: coluna `ranges` em `criteria` é json, então usamos jsonb_set + to_jsonb
-- pra atualizar índices específicos sem reescrever o array inteiro.

-- Protagonist — clarifica que "marcante" é presença/agência, não qualidade percebida.
UPDATE criteria
SET description = 'Avalia o quanto o protagonista se destaca e impacta a história — presença, agência, decisões marcantes, personalidade reconhecível.
NÃO avalia se o protagonista é simpático, bem escrito, equilibrado ou agradável de acompanhar. Mary Sues, OPs, vilões marcantes, FLs frias/insensíveis/inconsistentes podem todos ser muito marcantes.'
WHERE slug = 'protagonist' AND eval_type = 'IA';

-- Couple dynamics — esclarece que dinâmica não-tradicional consensual NÃO é 0-3.
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{0}',
  to_jsonb('0-3 | Dinâmica prejudicial ao parceiro contra sua vontade: abuso emocional ativo, manipulação não-consensual, sofrimento contínuo do parceiro abusado dentro do desenvolvimento. Dinâmicas não-tradicionais (BDSM, Dom/Sub, posse, ciúme intenso) com consenso mútuo e tom romântico/cômico NÃO se enquadram aqui — vão para 7-8 ou 9-10.'::text)
)::json
WHERE slug = 'couple_dynamics' AND eval_type = 'IA';

-- Romance — remove "desenvolvimento lento" da faixa 4-6 (slow burn é core, não subplot).
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{1}',
  to_jsonb('4-6 | Subplot: romance existe, mas não guia a história; pouco foco ou em background. NOTA: slow burn com foco romântico claro NÃO é subplot — é core romance (7-8).'::text)
)::json
WHERE slug = 'romance' AND eval_type = 'IA';

-- Adult content — proíbe faixa 0-3 quando há marcador R19 mesmo sem corroboração.
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{0}',
  to_jsonb('0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita. NÃO use esta faixa se há marcador R19 disponível na obra, mesmo sem corroboração de tag/review (piso 6.0).'::text)
)::json
WHERE slug = 'adult_content' AND eval_type = 'IA';
