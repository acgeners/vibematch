-- 197 · Fantasy e Nobility como critérios de IA separados, com seed de transição.
--
-- ✅ APLICADA na NUVEM em 2026-09-21 (Management API, transação única), com autorização
-- explícita e backup verificado antes (.backups/2026-09-21T09-15-15-691Z). O seed
-- (`scripts/seed-fantasy-nobility-legado.ts`) rodou em seguida: 2.050 linhas.
--
-- CONTEXTO. `fantasy_nobility` é um construto MISTO, e isso foi medido (auditoria, etapa 56):
-- r(fantasia, nobreza) = 0,118 — eixos praticamente independentes — e das 839 obras com nota >= 7,
-- 48,3% são só nobreza, 8,3% só fantasia, 21,1% ambas e 22,3% nem uma nem outra. A MESMA nota
-- significa quatro coisas. Ele NÃO é renomeado: continua existindo como legado.
--
-- 🔴 ORDEM OBRIGATÓRIA. `lib/calculations/scoring-features.ts` (SCORING_CRITERION_SLUGS, 9
-- congelados) PRECISA estar no ar ANTES desta migration. Sem ele, `CRITERION_SLUGS` vira 11 e:
--   · a guarda de `server/actions/calculations.ts` passa a exigir 11 notas ⇒ as ~1.010 obras
--     perdem `expected_score` até o seed rodar — sem erro e sem log;
--   · o Ridge, a Bússola, os embeddings e os pesos inferidos ganham 2 colunas que, durante a
--     transição, são CÓPIAS EXATAS de `fantasy_nobility`.
--
-- Depois de aplicar: rodar `npm run sync-constants` (CRITERION_SLUGS 9 → 11).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Os dois critérios. A FK de category_scores aponta para cá, então vêm primeiro.
--     `weight` é NOT NULL e é o peso da RUBRICA; quem decide o cálculo é score_weights (passo 3).
-- ─────────────────────────────────────────────────────────────────────────────
insert into criteria (eval_type, slug, criteria, weight, emoji, description, ranges)
values
  ('IA', 'fantasy', 'Fantasia', 6, '✨',
   'Avalia a presença e a participação de magia, poderes, criaturas ou fenômenos NÃO explicados como ciência.' || chr(10) ||
   'O teste é ontológico, não visual: tecnologia extraordinária que a obra explica como ciência não conta, e estética fantástica sem fenômeno atuante também não.',
   json_build_array(
     '0-3 | Ausente: nenhum elemento mágico/sobrenatural ATUANTE. Estética fantástica sem fenômeno operante é esta faixa.',
     '4-6 | Pontual: mecanismo sobrenatural presente e NÃO recorrente — dispara a premissa e sai de cena.',
     '7-8 | Estrutural: o fenômeno sobrenatural opera continuamente, ainda que de escopo ontológico estreito.',
     '9-10 | Onipresente: magia, poderes ou criaturas participam CONTINUAMENTE do mundo e da experiência.'
   )),
  ('IA', 'nobility', 'Nobreza', 6, '👑',
   'Avalia o quanto aristocracia, realeza e política de corte fazem parte da obra.' || chr(10) ||
   'Considera se o título nobiliárquico é só rótulo ou se hierarquia, sucessão, etiqueta e disputa de poder movem os conflitos. Mundo mágico sem corte NÃO conta aqui.',
   json_build_array(
     '0-3 | Ausente: sem estrutura nobiliárquica relevante, ou título só de fachada (é "duque", mas isso não muda nada).',
     '4-6 | Presente mas secundário: há nobres ou corte, porém hierarquia e política não organizam os conflitos.',
     '7-8 | Estrutural: posição social, sucessão, etiqueta ou disputa de poder moldam os conflitos principais.',
     '9-10 | Onipresente: a corte é o palco — hierarquia, alianças e política nobiliárquica sustentam quase tudo que acontece.'
   ))
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · A provenance do seed. O CHECK é lista FECHADA, então o valor novo entra por aqui.
--     `legacy_split_copy` = "esta nota é uma cópia do critério misto, não uma avaliação".
-- ─────────────────────────────────────────────────────────────────────────────
alter table category_scores drop constraint if exists category_scores_source_valid;
alter table category_scores add constraint category_scores_source_valid
  check (source = any (array[
    'manual'::text, 'imported'::text, 'ai_accepted'::text, 'ai_edited'::text,
    'ai_calibrated'::text, 'legacy_split_copy'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Pesos DESLIGADOS. É isto que mantém a Nota.IA idêntica: `gpt.ts` filtra `is_active`, e
--     `calculations.ts` lê score_weights já com `.eq("is_active", true)`.
--     🔴 Sem estas linhas o critério entraria na Nota.IA com peso 0 e ZERO erro — pior, porque
--     ficaria indistinguível de uma escolha.
-- ─────────────────────────────────────────────────────────────────────────────
insert into score_weights (slug, name, weight, threshold, is_active, display_order)
values ('fantasy', 'Fantasia', 0, null, false, 10),
       ('nobility', 'Nobreza',  0, null, false, 11)
on conflict (slug) do nothing;

commit;
