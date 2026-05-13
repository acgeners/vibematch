-- ============================================================
-- 003 - SEED: pesos dos critérios e configuração inicial
-- ============================================================

-- Critérios de avaliação (pesos extraídos da aba Categorias do XLSX)
INSERT INTO score_weights (slug, name, weight, max_negative_threshold, display_order) VALUES
  ('romance',           'Romance',               10,    NULL, 1),
  ('couple_dynamics',   'Dinâmica do Casal',       9,    NULL, 2),
  ('fantasy_nobility',  'Fantasia/Nobreza',         6,    NULL, 3),
  ('action_adventure',  'Ação/Aventura',             8,    NULL, 4),
  ('adult_content',     'Conteúdo Adulto',           6,    NULL, 5),
  ('protagonist',       'Protagonista Marcante',    10,    NULL, 6),
  ('humor',             'Humor',                    7,    NULL, 7),
  ('drama',             'Drama',                   -4,     5.0, 8),
  ('tragedy',           'Tragédia',               -10,     3.0, 9);

-- Configuração inicial da fórmula
INSERT INTO formula_config (formula_version, mae_calc, mae_predicted, pseudo_votes_nota_m, pseudo_votes_blend)
VALUES ('v1', 1.2657, 0.9246, 1767.0, 1024.0);
