-- O tooltip do Alinhamento descrevia uma fórmula APOSENTADA há dois meses.
--
-- 🔴 O QUE ESTAVA NO AR: `ui_labels.personal_fit.tooltip_full` dizia
--   "Junta tags amadas/evitadas, faixas ideais de critério e consistência geral."
-- Critério e consistência saíram do cálculo em 27/06/2026, quando `computePersonalFit`
-- foi substituída por `netNameOverlap` (`lib/ai-recommendation/personal-fit.ts`), que lê
-- SÓ `work_tags` — nem `criterion_preferences`, nem consistência, nem `work_genres`.
-- A função antiga foi REMOVIDA do código em 15/08/2026; o texto ficou.
--
-- ⚠️ POR QUE ISTO IMPORTA MAIS DO QUE UM TOOLTIP: esta linha não descreve uma tela, ela
-- descreve o NÚMERO — e alimenta três superfícies de uma vez (o seletor de colunas do
-- /catalog e do /ranking, o tooltip do heatmap e o painel de filtros), todas por
-- `LABELS.personal_fit.tooltip_full`. Quem lesse qualquer uma delas para entender por que
-- uma obra pontua baixo iria procurar em `/preferences` uma faixa de critério que não
-- influencia nada. É a família "dois critérios pro mesmo fato" no formato mais caro: o
-- lado que a pessoa LÊ sendo o errado, com o código certo e calado.
--
-- Esta correção é pré-requisito do /guide/scores: a página deriva de `ui_labels`, então
-- publicá-la antes daqui só ampliaria o alcance da frase errada para uma quarta superfície.
--
-- O texto novo diz o que o cálculo faz hoje, incluindo os dois fatos que mudam a leitura:
-- as evitadas pesam 1,5× e não há denominador (obra com mais tags tende a pontuar mais).
--
-- Valor anterior, para reversão:
--   tooltip_full : 'O quanto a obra combina com seu perfil de gosto, como percentil na sua biblioteca (0–100; Top 25% = ≥75). Junta tags amadas/evitadas, faixas ideais de critério e consistência geral.'
--   tooltip_short: 'O quanto a obra combina com seu perfil (percentil 0–100).'

update public.ui_labels
set
  tooltip_full = 'O quanto as tags da obra batem com o que você ama e evita, como percentil na sua biblioteca (0–100; Top 25% = ≥75). Soma as tags amadas presentes e desconta as evitadas, que pesam 1,5×. Só tags: critério, gênero e nota externa não entram — e a soma não tem denominador, então obra com muitas tags tende a pontuar mais.',
  tooltip_short = 'O quanto as tags da obra batem com seu gosto (percentil 0–100).'
where field = 'personal_fit';
