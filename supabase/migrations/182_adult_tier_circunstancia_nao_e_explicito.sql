-- 182_adult_tier_circunstancia_nao_e_explicito.sql
-- Reclassifica de 'explicit' para 'label' as tags de adult_content que descrevem a
-- CIRCUNSTÂNCIA do sexo — não o fato de a cena ser MOSTRADA graficamente.
--
-- `tags.adult_score_tier` (migração 174) tem três valores: 'explicit' → piso 9,0
-- (EXPLICIT_FLOOR, a faixa "Smut"), 'label' → piso 7,0 (ADULT_LABEL_FLOOR, a faixa
-- "Mature" = sexo mostrado PARCIALMENTE), null → sem piso.
--
-- O tier 'explicit' afirma uma coisa só: "há cena de sexo explícito retratada". Mas a
-- lista migrada em 174 misturou atos gráficos (Cunnilingus, Anal Sex, Bukkake) com
-- tags que dizem QUE VEZ, ONDE, EM QUE ESTADO ou COM QUEM o sexo acontece. Essas
-- afirmam que HÁ sexo na obra — o que é verdade e merece piso — mas não dizem nada
-- sobre a cena ser desenhada. O caso que fecha o argumento é `Clothed Intercourse`:
-- descreve sexo VESTIDO e valia piso 9,0 = "há cena de sexo explícito".
--
-- Estrago medido em 2026-08-09 (clone local, 973 obras com os 9 atributos):
--   · 64 obras têm como ÚNICA evidência de "explicit" uma tag de circunstância;
--   · TODAS as 64 estão em 9,0 ou 9,5 — nenhuma em outro valor;
--   · em 24 delas a prosa da própria avaliação argumenta faixa 0-3 ou 4-6. Exemplo:
--     "Faixa 4-6 (Suggestive): … consenso forte entre os leitores afirma
--      explicitamente que a obra NÃO é smut/explícita, sendo no máximo insinuada."
--     — obra persistida em 9,0, por causa da tag `Drunken Intercourse`;
--   · a média dessas 64 é 9,04 contra 7,30 do que o modelo tinha proposto (−1,74).
--
-- `First-Time Intercourse` sozinha alcança 83 obras: uma primeira vez com fade to
-- black continua sendo uma primeira vez, e ganhava o piso máximo por isso.
--
-- ⚠️ Isto NÃO conserta as notas já persistidas. `clampAdultContentScore` só empurra
--    a nota PARA DENTRO da faixa — baixar um piso não desfaz o que ele subiu. Quem
--    cura é `scripts/adult-content-retroactive-bounds.ts`, que passou a recalcular a
--    partir da nota COMMITADA na avaliação em vez da nota persistida.
--
-- ⚠️ Rode `npm run sync-constants` depois? NÃO é preciso: `adult_score_tier` não entra
--    em nenhum arquivo gerado — é lido em runtime por `computeAdultContentBounds`.

update tags
set adult_score_tier = 'label'
where adult_score_tier = 'explicit'
  and name in (
    -- que vez / em que estado
    'First-Time Intercourse',
    'Drunken Intercourse',
    'Pregnancy Sex',
    -- onde
    'Outdoor Intercourse',
    'Public Sex',
    'School Intercourse',
    'Office Intercourse',
    'Toilet Intercourse',
    'Prison Sex',
    'Mirror Sex',
    -- com quem
    'Enemies Have Sex',
    -- posição (descreve a mecânica, não o grau de exposição)
    'Missionary Position',
    'Cowgirl Position',
    'Doggy Style',
    'Sitting Sex',
    -- sem contato físico retratado
    'Phone Sex',
    -- mecânica de mundo
    'Sex Magic',
    -- literalmente vestido
    'Clothed Intercourse'
  );
