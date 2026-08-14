-- 190: a banda dos tiers vai de 0,5 para 0,25 — a validação que a 104 pedia foi feita
-- e nunca chegou ao banco.
--
-- A 104 gravou 0,5 como "ponto de partida … deve ser VALIDADO empiricamente". A medição
-- saiu em 2026-08-06 (commit 0351cee) e trocou DEFAULT_TIER_BAND_WIDTH para 0,25 — mas
-- o UPDATE que a mensagem daquele commit anunciava nunca rodou: em 2026-08-13 LOCAL e
-- NUVEM ainda tinham 0.5, com updated_at de 2026-07-23 (duas semanas ANTES do commit).
--
-- E a constante do código é só FALLBACK: `resolveTierBandWidth` só a usa quando o valor
-- é ausente, e esta coluna é NOT NULL. Ou seja, o valor medido nunca esteve em vigor —
-- o /ranking agrupou a 0,5 o tempo todo.
--
-- O critério da medição: dos pares que a banda declara equivalentes, quantos a Nota
-- Prevista teria ordenado corretamente? ~50% = agrupar é honesto. Sobre as 206 obras
-- com nota do usuário:
--
--   banda 0,20 → 52,7%   honesto
--   banda 0,25 → 53,3%   honesto   ← este valor
--   banda 0,30 → 53,8%   honesto
--   banda 0,35 → 55,0%   limítrofe
--   banda 0,50 → 57,9%   jogava fora sinal que existia
--
-- O desempate entre 0,20–0,30 veio do catálogo (975 obras): 0,25 é o mais estável a
-- reamostragem (19,9% ± 0,7 contra 17,0% ± 2,5 e 26,2% ± 1,3). Ver lib/ranking/tier-config.ts.
--
-- ⚠️ O DEFAULT da coluna muda junto de propósito: sem isso um banco recriado do zero
-- nasceria em 0,5 de novo, e a divergência voltaria sem nada acusar — que é exatamente
-- como ela durou uma semana. O par (DEFAULT da coluna, DEFAULT_TIER_BAND_WIDTH) é
-- guardado por tests/unit/ranking/tier-config.test.ts.

ALTER TABLE formula_config
  ALTER COLUMN tier_band_width SET DEFAULT 0.25;

-- Condicionado a 0.5 de propósito: só corrige quem ainda está no ponto de partida da
-- 104. Um valor escolhido à mão depois disto é decisão de alguém, não deve ser
-- sobrescrito por uma migration.
UPDATE formula_config
  SET tier_band_width = 0.25
  WHERE tier_band_width = 0.5;

COMMENT ON COLUMN formula_config.tier_band_width IS
  'Largura das bandas do ranking (agrupamento visual de tiers). 0,25 = valor MEDIDO em 2026-08-06 por acurácia pairwise sobre as obras com nota do usuário + estabilidade a reamostragem no catálogo (ver lib/ranking/tier-config.ts). Ajustável sem mudança de código; remedir quando o número de obras avaliadas crescer bastante.';
