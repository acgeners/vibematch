-- 164_adult_content_rubric_explicit.sql
-- Recalibra a rubrica de adult_content pra separar NATUREZA do conteúdo de FREQUÊNCIA,
-- e desfaz o piso de R19 que a migration 063 introduziu na faixa 0-3.
--
-- Diagnóstico (2026-07-24, sobre 349 avaliações em que o piso do R19 disparou):
--   · 166 (48%) vinham SÓ do marcador que o pipeline reinjeta na sinopse a partir de
--     boilerplate da fonte ("Original Webtoon: R19", "Official Translations (R19)").
--     Esse marcador significa "existe uma edição R19 em algum lugar", não "esta obra
--     mostra conteúdo explícito" — e frequentemente a obra avaliada é justamente a
--     versão sem ele.
--   · O resultado eram notas que contradiziam a própria justificativa, do tipo:
--     "não há evidência explícita de sexo recorrente nas reviews, que inclusive
--      mencionam romance e 'smut' como algo escasso. Ainda assim, o marcador R19
--      exige nota mínima de 6."
--
-- Duas mudanças de semântica:
--   1. A faixa 9-10 não exige mais que o sexo explícito seja RECORRENTE. Qualquer
--      quantidade de cena explícita coloca a obra em 9-10 — frequência muda o FOCO
--      da obra, não a natureza do conteúdo.
--   2. A faixa 0-3 volta a ser sobre o conteúdo, sem o piso do R19. O piso/teto
--      obrigatório agora é calculado por PROCEDÊNCIA do sinal (tag de ato explícito,
--      gênero adulto, classificação da fonte) em lib/ai-evaluation/adult-content-rules.ts
--      e chega ao modelo pelo prompt do usuário — nunca por keyword em texto livre.
--
-- ⚠️ Rode `npm run sync-constants` depois de aplicar, pra regenerar
--    lib/constants/criteria.ts (a rubrica do prompt é montada a partir dele).
-- Obs.: `ranges` é json, então usamos jsonb_set + to_jsonb pra trocar índices
--       específicos sem reescrever o array inteiro (mesmo padrão da 063).

-- Faixa 0-3 — remove o piso do R19 (era a origem do artefato).
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{0}',
  to_jsonb('0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita. Marcador de EDIÇÃO ("R19 disponível", "Original Webtoon: R19") NÃO impede esta faixa: ele diz que existe uma edição R19 da história, não que a obra avaliada mostre algo.'::text)
)::json
WHERE slug = 'adult_content' AND eval_type = 'IA';

-- Faixa 4-6 — explicita que nada é MOSTRADO nesta faixa.
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{1}',
  to_jsonb('4-6 | Suggestive: insinuação clara, roupas/situações/tensão sexual; nada de sexo é mostrado — pode ter cena cortada/fade to black.'::text)
)::json
WHERE slug = 'adult_content' AND eval_type = 'IA';

-- Faixa 7-8 — fronteira com a 9-10: aqui o sexo aparece PARCIALMENTE, sem cena explícita.
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{2}',
  to_jsonb('7-8 | Mature: sexo mostrado PARCIALMENTE, sem cena explícita; nudez e contexto sexual relevante para a trama. Se existe cena explícita, mesmo uma só, a faixa é 9-10.'::text)
)::json
WHERE slug = 'adult_content' AND eval_type = 'IA';

-- Faixa 9-10 — a mudança central: sai "recorrente".
UPDATE criteria
SET ranges = jsonb_set(
  ranges::jsonb,
  '{3}',
  to_jsonb('9-10 | Smut: há cena de sexo explícito, em QUALQUER quantidade. Uma única cena basta. NÃO rebaixe porque é pouco frequente, escasso ou porque o foco da obra é outro — frequência muda o FOCO, não a natureza do conteúdo.'::text)
)::json
WHERE slug = 'adult_content' AND eval_type = 'IA';
