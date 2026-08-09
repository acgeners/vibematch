-- 181_couple_dynamics_description_vinculos.sql
-- Termina a ampliação de `couple_dynamics` que a 95226f7 (2026-07-27) deixou pela metade.
--
-- Naquele dia o critério foi renomeado "Dinâmica do Casal" → "Dinâmica entre Protagonistas"
-- e as FAIXAS da rubrica foram ampliadas ("parceiro" → "vínculos centrais", "conduta",
-- "quem é próximo", "crueldade com antagonistas NÃO rebaixa"). A `description`, porém,
-- continuou dizendo "a relação entre o casal principal".
--
-- Isso não é cosmético: `buildCriteriaPromptSection()` cola a description ACIMA das faixas,
-- no MESMO bloco do prompt de avaliação. O modelo lia, em três linhas seguidas:
--
--   2. couple_dynamics (Dinâmica entre Protagonistas)            ← amplo
--   Descrição do critério: … a relação entre o casal principal.  ← restrito
--   - 0-3 | Destrutiva: dano … DENTRO dos vínculos centrais…     ← amplo
--
-- E o slug segue `couple_dynamics`, então "couple" é a primeira palavra que ele lê.
--
-- Medido em 2026-08-09 (clone local, 973 obras com os 9 atributos): das 18 obras com
-- `romance ≤ 3`, 17 (94,4%) estavam com couple_dynamics travado em 5,0 — o critério era
-- efetivamente inexistente fora de romance, que é justo o caso que a ampliação queria cobrir.
-- (O clamp `enforceNeutralCoupleDynamicsWhenNoRomance`, que produzia esse 5,0, saiu no
-- mesmo PR: quem decide "não aplicável" passou a ser o prompt, por ausência de VÍNCULO —
-- não por ausência de romance.)
--
-- A description nova carrega a ORDEM DE PRIORIDADE do vínculo a avaliar. Sem ela, "vínculos
-- centrais" é ambíguo em obra que tem casal E família: dois avaliadores escolheriam vínculos
-- diferentes e as notas não seriam comparáveis entre si — que é a mesma classe de problema
-- das réguas misturadas.
--
-- ⚠️ Rode `npm run sync-constants` depois de aplicar, pra regenerar
--    `lib/constants/criteria.ts` (arquivo GERADO — nunca editar à mão).

update criteria
set description =
  'Avalia a qualidade da dinâmica entre os personagens principais — o vínculo MAIS CENTRAL da obra, nesta ordem de prioridade: casal principal; depois família (pais, irmãos, filhos); depois os demais vínculos recorrentes (mestre e discípulo, equipe, rivalidade, amizade). Numa obra de romance é sobre o casal; num drama familiar, entre o protagonista e a família.' || chr(10) ||
  'Considera se a dinâmica é destrutiva, conflituosa, saudável, divertida, comunicativa ou baseada em parceria.'
where slug = 'couple_dynamics';
