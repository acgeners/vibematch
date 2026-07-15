-- 158 — Preferência: desagrupa "Protagonistas & Casal" em 3 eixos finos de personagem.
--
-- Contexto (análise da sessão 2026-07-15): a avaliação craft foi APOSENTADA da UI (PR #154). Ficou
-- um questionário só, de GOSTO. O único refino que os dados justificam é desagrupar os personagens
-- — hoje um eixo só (`like_leads_score`, "Protagonistas & Casal"), apesar de o gosto do dono ser
-- MUITO puxado por eles (peso +0.79). O `craft:FL`/`craft:ML` só somavam porque esse eixo agrupava
-- demais; aqui isso vira preferência fina, sem trazer o craft de volta.
--
-- ADITIVA — NADA é dropado. `like_leads_score` (coluna + critério) e `like_overall_score` (veredito)
-- FICAM; somem só da TELA, via código (TASTE_SCORE_KEYS). O DROP delas é uma fase 2 separada, só
-- depois de confirmar o novo — aditivo é reversível, drop não é, e o banco não tem backup.
--
-- A ORDEM de exibição passa a ser controlada por `TASTE_SCORE_KEYS` no código (não por `criteria.id`),
-- então o id novo dos critérios não importa.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/158_preferencia_personagens_finos.sql

begin;

-- 1) Colunas novas no espelho de gosto (mesma escala/check dos demais eixos).
alter table pilot_taste_scores
  add column if not exists like_female_lead_score numeric(3,1)
    check (like_female_lead_score is null or like_female_lead_score in (2, 4, 6.5, 8, 10)),
  add column if not exists like_male_lead_score numeric(3,1)
    check (like_male_lead_score is null or like_male_lead_score in (2, 4, 6.5, 8, 10)),
  add column if not exists like_couple_score numeric(3,1)
    check (like_couple_score is null or like_couple_score in (2, 4, 6.5, 8, 10));

-- 2) Critérios novos (eval_type='Gosto'). `key` = nome da coluna; é o que a UI usa (não o id).
insert into criteria (eval_type, criteria, slug, key, emoji, weight, description, ranges) values
  (
    'Gosto', 'Female Lead', 'taste_female_lead', 'like_female_lead_score', '👩', 1,
    E'• O quanto você se apegou/torceu pela protagonista\n• Se o TIPO dela combina com o que você curte (não se é "bem escrita")\n\n→ Você clicou com ela, ou te deixou indiferente/irritado?',
    '["★ → Não conectei / me irritou; o tipo de protagonista atrapalhou meu gosto.","★★ → Pouco apego; cumpriu o papel, mas não me pegou.","★★★ → Curti o suficiente pra acompanhar com gosto, sem virar favorita.","★★★★ → Me apeguei, torci, curti muito — puxou meu gosto pra cima.","★★★★★ → Amei; a protagonista foi um dos principais motivos de eu amar a obra."]'::jsonb
  ),
  (
    'Gosto', 'Male Lead', 'taste_male_lead', 'like_male_lead_score', '👨', 1,
    E'• O quanto você se apegou/torceu pelo protagonista\n• Se o TIPO dele combina com o que você curte (não se é "bem escrito")\n\n→ Você clicou com ele, ou te deixou indiferente/irritado?',
    '["★ → Não conectei / me irritou; o tipo de protagonista atrapalhou meu gosto.","★★ → Pouco apego; cumpriu o papel, mas não me pegou.","★★★ → Curti o suficiente pra acompanhar com gosto, sem virar favorito.","★★★★ → Me apeguei, torci, curti muito — puxou meu gosto pra cima.","★★★★★ → Amei; o protagonista foi um dos principais motivos de eu amar a obra."]'::jsonb
  ),
  (
    'Gosto', 'Casal e Interações', 'taste_couple', 'like_couple_score', '💞', 1,
    E'• A química e a dinâmica entre os protagonistas\n• As interações do casal/dupla central — se te prenderam\n\n→ A relação entre eles te puxou, ou foi morna/sem sal?',
    '["★ → Sem química; as interações não me pegaram ou incomodaram.","★★ → Funcionou, mas a dinâmica não me prendeu.","★★★ → Curti as interações o suficiente pra acompanhar com gosto.","★★★★ → Ótima química; a dinâmica do casal puxou meu gosto pra cima.","★★★★★ → Amei o casal; a relação foi um dos principais motivos de eu amar a obra."]'::jsonb
  );

commit;
