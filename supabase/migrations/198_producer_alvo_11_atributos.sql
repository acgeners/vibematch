-- 198 · O producer alvo dos 11 atributos (`c1`), e a aposentadoria dos dois legados.
--
-- 🔴 NÃO APLICADA. Criada em 2026-09-22 junto com o código da branch `feat/producer-alvo-11`.
-- Aplicar exige autorização própria, e a ORDEM importa (ver o bloco ORDEM abaixo).
--
-- CONTEXTO. O producer alvo é o `v29+alvo11-c1` (sha256 do SYSTEM_PROMPT
-- 3f79a80619919b7673a36d852b620df2f1dcbec286a70f4f75c3581eebf77109), o último estado do
-- candidato com teste favorável. O `c3` e o `c4` NÃO entram: o reteste do `c4` deu `NÃO SEGUE`
-- e a diferença `c3 -> c4` mediu-se indistinguível de duas runs do MESMO prompt (9,1% x 9,1%).
--
-- O QUE MUDA:
--   · `setting_era` (Ambientação Temporal) e `angst` (Angústia) passam a existir como IA;
--   · `action_adventure` passa a se chamar "Dinamismo Narrativo" — o SLUG NÃO muda, porque é
--     chave técnica histórica com FK em category_scores e ai_evaluation_scores;
--   · os blocos operacionais do c1 (FRONTEIRA PRINCIPAL, REGRA LONGITUDINAL, ÂNCORAS, NÃO FAÇA)
--     passam a viver em `criteria.guidance` — coluna NOVA, nullable, que `sync-constants` emite
--     e `buildCriteriaPromptSection()` renderiza DEPOIS das faixas;
--   · `fantasy_nobility` e `nobility` saem de `eval_type='IA'` e viram 'Legado'.
--
-- 🔴 NENHUM DADO É APAGADO. As FKs de `category_scores` e `ai_evaluation_scores` apontam para
-- `criteria.slug` com ON DELETE RESTRICT, e continuam válidas: a linha permanece, só muda o
-- `eval_type`. Seguem intocados: os 1.026 `category_scores` de cada legado (inclusive os 1.025
-- `legacy_split_copy`), os 2.513 `ai_evaluation_scores` de `fantasy_nobility`, as 176
-- `user_attribute_assessment` e o `attribute_bias` de 113 amostras.
--
-- 🔴 `fantasy` NÃO herda a calibração humana do legado (decisão de produto, 2026-09-22): o
-- `attribute_bias` dele começa em n=0 e acumula sozinho. Copiar o viés de um construto MISTO
-- para um construto NOVO afirmaria uma medição que não houve.
--
-- ── ORDEM OBRIGATÓRIA: DEPLOY PRIMEIRO, ESTA MIGRATION DEPOIS ────────────────────────────────
--
-- 🔴 O risco NÃO é a guarda de completude, e esta linha já afirmou que era. Medido em
-- 2026-09-22: `fantasy` tem valor nas 1.026 obras (seed `legacy_split_copy` da 197), então o
-- `expected_score` sobrevive nos dois estados — 5 obras sem nota antes e 5 depois, as mesmas.
--
-- 🔴 O risco REAL é um HÍBRIDO no cálculo, e ele vem de o conjunto da Nota.IA sair do BANCO
-- (`gpt.ts` itera `score_weights` filtrando `is_active`) enquanto o do Ridge sai do CÓDIGO
-- (`SCORING_CRITERION_SLUGS`). Medido nos quatro estados:
--
--   A · código antigo + banco atual   → coerente
--   B · código NOVO   + banco atual   → Nota.IA sobre `fantasy_nobility`, Ridge sobre `fantasy`
--   C · código antigo + banco pós-198 → Nota.IA sobre `fantasy`, Ridge sobre `fantasy_nobility`
--   D · código NOVO   + banco pós-198 → coerente
--
-- B e C gravariam `calculated_scores` das 1.027 obras com metade de cada contrato, sem erro e
-- sem log — hoje quase invisível (as colunas são cópias em 1.025 de 1.026) e crescendo sozinho
-- conforme avaliações reais chegarem.
--
-- 🟢 O estado B está FECHADO por código: `computeRecalc` aborta quando os dois conjuntos
-- divergem (`lib/calculations/scoring-contract.ts`), sem gravar nada e deixando `recalc_pending`
-- de pé. Conferido contra a nuvem: o recalc ABORTA hoje com o código novo, e volta a rodar
-- assim que esta migration passa o peso de `fantasy_nobility` para `fantasy` (passo 5).
--
-- ⚠️ O estado C NÃO tem essa rede: o bundle antigo já está no ar e não conhece a guarda. Por
-- isso a ordem é obrigatória — aplicar esta migration ANTES do deploy cria um híbrido que nada
-- acusa. Se isso acontecer por acidente, a saída é deployar imediatamente.
--
-- SEQUÊNCIA:
--   1. deploy do código  (estado B — recalc ABORTA, avaliação de IA ABORTA pelo criteria-guard)
--   2. esta migration    (estado D)
--   3. `npm run sync-constants`  → deve dar DIFF ZERO (a branch já traz o output esperado)
--   4. `npm run contracts`       → confere o contrato do PostgREST contra o banco
--   5. o recalc pendente volta a rodar sozinho no gatilho seguinte, já no contrato novo

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Colunas novas de `criteria`. Nullable: critério sem guidance não emite nada,
--     e `display_order` nulo cai no desempate por `id` (o comportamento de hoje).
-- ─────────────────────────────────────────────────────────────────────────────
alter table criteria add column if not exists guidance json;
alter table criteria add column if not exists display_order integer;

comment on column criteria.guidance is
  'Blocos operacionais da rubrica (FRONTEIRA PRINCIPAL, REGRA LONGITUDINAL, ÂNCORAS, NÃO FAÇA), um por item. Renderizados no SYSTEM_PROMPT logo APÓS as faixas. Fonte: producer c1.';
comment on column criteria.display_order is
  'Ordem dos critérios no prompt e na UI. Existe porque a ordem vinha do `id` (sequência de inserção) e o producer c1 pede fantasy/setting_era na posição 3/4, antes de action_adventure.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Os dois critérios NOVOS. FK de category_scores aponta para cá, então vêm primeiro.
--     `weight` é o peso da RUBRICA (NOT NULL); quem decide o cálculo é score_weights (passo 5).
--     ⚠️ Os emojis são escolha COSMÉTICA desta migration — o c1 não documenta emoji.
-- ─────────────────────────────────────────────────────────────────────────────
insert into criteria (eval_type, slug, criteria, weight, emoji, display_order, description, ranges, guidance)
values
  ('IA', 'setting_era', 'Ambientação Temporal', 6, '🏛️', 4,
   'Bipolar. Posição entre mundos inspirados em períodos pré-modernos e ambientes contemporâneos. Pergunta canônica: "em que DIREÇÃO temporal e social está a ambientação?"',
   json_build_array(
     '0-3 | Ambientação histórica / de época / pré-moderna — inclusive mundos INSPIRADOS em períodos pré-modernos, sem historicidade real.',
     '4-6 | A obra ocupa os DOIS lados de forma material — o presente é atravessado por outra época de modo estrutural.',
     '7-8 | Contemporânea COM deslocamento temporal que não muda a direção.',
     '9-10 | Contemporânea sem truque · futurista entra aqui como extensão declarada do polo.'
   ),
   json_build_array(
     'FRONTEIRA PRINCIPAL — DIREÇÃO, não historicidade. A escala responde para que lado a ambientação aponta. Um mundo pré-moderno FICCIONAL está no polo histórico porque a direção é clara; que ele não seja um período real é ressalva que viaja, não deslocamento de faixa.',
     'ÂNCORAS: 0-3 Whale Star (histórico sem nobreza e sem magia), A Bride''s Story (histórico cotidiano), Villains Are Destined to Die (de época/pré-moderno inspirado) — 4-6 See You in My 19th Life (memória de épocas ≠ obra histórica) — 7-8 Marry My Husband (regrediu ≠ virou histórico) — 9-10 A Business Proposal, Semantic Error; Cyberpunk Edgerunners como extensão futurista.',
     'NÃO FAÇA: medir grau de historicidade (o eixo é direção; Villains prova a diferença) · regressão/reencarnação = histórico (Marry My Husband) · memória de outras épocas = obra histórica (See You in My 19th Life) · chamar mundo pré-moderno ficcional de "histórico realista".'
   )),
  ('IA', 'angst', 'Angústia', 6, '🥀', 11,
   'Unipolar de intensidade. Saldo entre ACÚMULO de sofrimento e ALÍVIO EFICAZ ao longo da leitura. Redutores contam pelo EFEITO, nunca pela presença.',
   json_build_array(
     '0-3 | Sofrimento resolvido ou compensado dentro da experiência.',
     '4-6 | Sofrimento presente COM alívio eficaz — o suporte de fato funciona.',
     '7-8 | O ACÚMULO SUPERA O ALÍVIO de forma recorrente.',
     '9-10 | Sofrimento persiste e se acumula; o alívio é ausente, tardio ou INEFICAZ.'
   ),
   json_build_array(
     'FRONTEIRA PRINCIPAL — O SALDO. Não é a quantidade de eventos ruins. Para SUBIR: o alívio precisa FALHAR ou CHEGAR TARDE. Para DESCER: o redutor precisa FUNCIONAR — presença de suporte não basta, ele tem que desfazer o acúmulo.',
     'ÂNCORAS: 9-10 What It Means to Be You (Angústia muito alta SEM Tragédia proporcional; o alívio chega DEPOIS do acúmulo), How to Win My Husband Over (suporte insuficiente) — 7-8 Villains Are Destined to Die — 0-3 A Sign of Affection (manga; sofrimentos resolvidos) — stress: Look Back (agudo × acumulativo), Betrayal of Dignity (toxicidade ≠ Angústia automática).',
     'NÃO FAÇA: contar eventos ruins (o que decide é o SALDO, não a quantidade) · deixar a presença de suporte abaixar a nota (o redutor conta pelo efeito — tem que funcionar) · toxicidade = Angústia (Betrayal of Dignity) · agudo = acumulativo (Look Back) · Drama alto ⇒ Angústia alta (Marry My Husband: Drama alto COM Angústia baixa) · Tragédia ⇒ Angústia (What It Means to Be You: Angústia muito alta SEM Tragédia proporcional).'
   ))
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · As rubricas do c1 nos critérios que já existiam. Idempotente: reaplica o mesmo texto.
--     🔴 `fantasy` recebe o bloco INTEGRAL do c1 — a migration 197 gravou uma paráfrase
--     REDUZIDA (sem os dois testes ordenados, sem as 7 âncoras, sem os 5 NÃO FAÇA).
-- ─────────────────────────────────────────────────────────────────────────────

update criteria set
  criteria = 'Romance',
  display_order = 1,
  description = 'Unipolar de intensidade. Participação e peso narrativo de uma relação romântica que SE DESENVOLVE ao longo da experiência.',
  ranges = json_build_array(
     '0-3 | Romance ausente ou marginal. Vínculo intenso não-romântico NÃO conta.',
     '4-6 | Romance presente com densidade baixa — formalizado, prometido ou motivador, sem desenvolvimento recorrente.',
     '7-8 | Romance recorrente e desenvolvido, ocupando parte relevante da experiência — inclusive quando o casal se estabelece cedo e o desenvolvimento continua.',
     '9-10 | Romance recorrente, desenvolvido e estruturante da experiência.'
   ),
  guidance = json_build_array(
     'FRONTEIRA PRINCIPAL — DENSIDADE de desenvolvimento. Não é presença, não é centralidade motivacional, não é intensidade da tensão. Para SUBIR: o romance precisa ocupar mais da experiência com desenvolvimento, não gerar mais tensão. Para DESCER: a relação existe mas não se desenvolve em cena.',
     'ÂNCORAS: 9-10 A Business Proposal, Semantic Error (recorrência longitudinal; slow burn de alta densidade) — 7-8 Another Typical Fantasy Romance (casal estabelecido cedo, desenvolvimento segue) — 0-3 Omniscient Reader (vínculo intenso que NÃO é romance) — fronteira 4-6/7-8 Kaguya-sama, Maybe Meant to Be.',
     'NÃO FAÇA: promover por tensão altíssima (Kaguya-sama: centralidade e tensão altíssimas com entrega concreta menor ⇒ não sobe) · tratar formalização como desenvolvimento (Maybe Meant to Be: a formalização precede a experiência romântica) · somar milestones tardios como densidade (Solo Leveling: milestones ≠ densidade proporcional) · ler vínculo intenso como romance · confundir com Conteúdo Adulto (ressalva de Semantic Error).'
   )
where slug = 'romance' and eval_type = 'IA';

update criteria set
  criteria = 'Dinâmica entre Protagonistas',
  display_order = 2,
  description = 'Avalia a qualidade da dinâmica entre os personagens principais — o vínculo MAIS CENTRAL da obra, nesta ordem de prioridade: casal principal; depois família (pais, irmãos, filhos); depois os demais vínculos recorrentes (mestre e discípulo, equipe, rivalidade, amizade). Numa obra de romance é sobre o casal; num drama familiar, entre o protagonista e a família.' || chr(10) || 'Considera se a dinâmica é destrutiva, conflituosa, saudável, divertida, comunicativa ou baseada em parceria.',
  ranges = json_build_array(
     '0-3 | Destrutiva: dano ativo/não-consensual DENTRO dos vínculos centrais — abuso, manipulação, sofrimento contínuo de quem é próximo. Devoção a um abusador não-arrependido também é 0-3 (autodestrutiva). Dinâmica não-tradicional CONSENSUAL (BDSM, posse, ciúme) com tom romântico/cômico NÃO entra aqui. Crueldade com antagonistas que a merecem NÃO rebaixa.',
     '4-6 | Conflituosa ou ambivalente: conflitos recorrentes, mal-entendidos prolongados, comunicação falha; ou conduta mista nos vínculos centrais (ajuda uns, prejudica outros).',
     '7-8 | Saudável: relação/conduta majoritariamente construtiva, respeito mútuo, conflitos pontuais resolvidos.',
     '9-10 | Construtiva: parceria, apoio mútuo, comunicação e crescimento conjunto. Dois personagens danificados que se curam e se entendem (cura ENCENADA, cedo na obra) são esta faixa.'
   ),
  guidance = null
where slug = 'couple_dynamics' and eval_type = 'IA';

update criteria set
  criteria = 'Fantasia',
  display_order = 3,
  description = 'Unipolar de intensidade. Presença e participação de magia, poderes, criaturas ou fenômenos NÃO explicados como ciência.',
  ranges = json_build_array(
     '0-3 | Nenhum elemento mágico/sobrenatural ATUANTE.',
     '4-6 | Mecanismo sobrenatural presente e NÃO recorrente — dispara a premissa e sai de cena.',
     '7-8 | Fenômeno sobrenatural ESTRUTURAL, ainda que de escopo ontológico estreito.',
     '9-10 | Magia/poderes/criaturas participam CONTINUAMENTE do mundo e da experiência.'
   ),
  guidance = json_build_array(
     'FRONTEIRA PRINCIPAL — dois testes, NESTA ORDEM. (1) Teste ontológico: como a obra explica o fenômeno? Explicado como ciência/tecnologia ⇒ NÃO é Fantasia, por mais extraordinário que seja. (2) Recorrência/participação: aparece uma vez e sai, ou opera no mundo continuamente? Para SUBIR: mais participação estrutural. Para DESCER: o fenômeno deixa de operar.',
     'ÂNCORAS: 9-10 Villains Are Destined to Die (interface de jogo NÃO é tecnologia explicada pela obra) — 7-8 Unholy Blood, See You in My 19th Life (escopo estreito, porém estrutural) — 4-6 Marry My Husband (mecanismo inicial ≠ recorrência) — 0-3 A Business Proposal, Whale Star, Semantic Error — stress: Cyberpunk Edgerunners (tecnologia extraordinária NÃO é Fantasia).',
     'NÃO FAÇA: tratar estética fantástica como Fantasia atuante (o teste é ontológico, não visual) · tecnologia extraordinária = Fantasia (Cyberpunk) · retelling de mito = Fantasia (Whale Star: o retelling de sereia não dá Fantasia) · pouca variedade = pouca participação (See You in My 19th Life) · premissa sobrenatural = faixa alta (Marry My Husband: dispara e sai).'
   )
where slug = 'fantasy' and eval_type = 'IA';

update criteria set
  criteria = 'Dinamismo Narrativo',
  display_order = 5,
  description = 'Bipolar. Posição entre uma história de rotina e pequenas mudanças e uma movida por eventos externos, objetivos, perigo e deslocamento. DESCRITIVO — não é avaliação de qualidade do pacing.',
  ranges = json_build_array(
     '0-3 | Rotina, convivência e conversa; acontecimentos reorganizam a convivência, não viram aventura.',
     '4-6 | Intermediário real — diálogo, investigação ou estratégia predominam COM progressão externa efetiva.',
     '7-8 | Eventos externos, objetivos e deslocamento movem a história de forma RECORRENTE.',
     '9-10 | Progressão material, deslocamento e perigo ESTRUTURAM a experiência.'
   ),
  guidance = json_build_array(
     'FRONTEIRA PRINCIPAL — O QUE MOVE A HISTÓRIA. Não é velocidade, não é presença de ação, não é volume de diálogo. Para SUBIR: mais da experiência é movida por evento externo e objetivo. Para DESCER: o que move volta a ser convivência e rotina.',
     'REGRA LONGITUDINAL: a banda representa o dinamismo CARACTERÍSTICO da experiência como um todo. Fases entram conforme sua RELEVÂNCIA. PROIBIDO: pico automático · fase final automática · média dos checkpoints · pesos por arco. Mudar de dinamismo não é premiado nem penalizado. Obra cotidiana com UM arco explosivo NÃO sobe pelo pico; obra que começa parada e passa a MAIOR PARTE com progressão constante PODE sustentar banda alta; fases substanciais em níveis diferentes ⇒ a banda reflete a experiência MISTA.',
     'ÂNCORAS: 0-3 Seasons of Blossom (cotidiano com Drama alto), Maybe Meant to Be — 4-6 The Ember Knight (diálogo/estratégia COM progressão externa) — 7-8 The Perks of Being an S-Class Heroine (aventureiro dentro de rofan) — 9-10 The Greatest Estate Developer (progressão material, crises, deslocamento), Blue Lock (alto SEM combate).',
     'NÃO FAÇA: pacing lento = Dinamismo baixo (Frieren: a leitura correta é intermediário) · ação presente = Dinamismo alto (Spy × Family) · exigir combate para faixa alta (Blue Lock) · Drama alto = Dinamismo alto (Seasons of Blossom) · muito diálogo = faixa baixa (The Ember Knight) · pontuar pelo arco mais movimentado.'
   )
where slug = 'action_adventure' and eval_type = 'IA';

update criteria set
  criteria = 'Conteúdo Adulto',
  display_order = 6,
  description = 'Avalia o nível de sexualização ou conteúdo sexual presente na obra.' || chr(10) || 'Considera desde ausência quase total até cenas explícitas recorrentes, levando em conta frequência, intensidade e relevância para a narrativa.',
  ranges = json_build_array(
     '0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita. Marcador de EDIÇÃO ("R19 disponível", "Original Webtoon: R19") NÃO impede esta faixa: ele diz que existe uma edição R19 da história, não que a obra avaliada mostre algo.',
     '4-6 | Suggestive: insinuação clara, roupas/situações/tensão sexual; nada de sexo é mostrado — pode ter cena cortada/fade to black.',
     '7-8 | Mature: sexo mostrado PARCIALMENTE, sem cena explícita; nudez e contexto sexual relevante para a trama. Se existe cena explícita, mesmo uma só, a faixa é 9-10.',
     '9-10 | Smut: há cena de sexo explícito, em QUALQUER quantidade. Uma única cena basta. NÃO rebaixe porque é pouco frequente, escasso ou porque o foco da obra é outro — frequência muda o FOCO, não a natureza do conteúdo.'
   ),
  guidance = null
where slug = 'adult_content' and eval_type = 'IA';

update criteria set
  criteria = 'Protagonista Marcante',
  display_order = 7,
  description = 'Unipolar de intensidade. Centralidade em cena E agência sobre a trama, de qualquer valência. Toda faixa descreve o nível REPRESENTATIVO do par (centralidade, agência) na experiência como um todo: quando uma das duas varia materialmente, as fases relevantes entram EM CONJUNTO — é PROIBIDO pontuar pelo pico, pela fase inicial, pela fase final, por média dos checkpoints ou por peso temporal. As fases são evidência, não parcelas.',
  ranges = json_build_array(
     '0-3 | Centralidade E agência representativas baixas — a personagem é conduzida pelos acontecimentos, e as decisões dela não têm efeito estrutural. Presença NÃO equivale a condução narrativa. É CONJUNÇÃO: agência baixa com centralidade alta é 4-6, não aqui.',
     '4-6 | Protagonismo moderado — centralidade OU agência é relevante, mas não as duas de forma forte E sustentada. As decisões importam sem que a personagem reorganize a narrativa de forma dominante. A agência pode ser parcial, localizada, diluída por coralidade ou não sustentada ao longo da obra.',
     '7-8 | Protagonismo forte — centralidade alta E agência real e consequente, representativas ao longo da experiência: as decisões alteram significativamente o curso da narrativa DENTRO de um enquadramento que a personagem não controla.',
     '9-10 | Protagonismo estruturante — a narrativa é fortemente organizada em torno dela E as escolhas dela reorganizam repetidamente o próprio ENQUADRAMENTO da história. Centralidade e agência ambas muito altas e representativas.'
   ),
  guidance = json_build_array(
     'NENHUMA TRAJETÓRIA É REQUISITO DE FAIXA: agência constrangida por sistema, agência sem poder institucional, agência que varia ao longo da obra e agência exercida em consequências relacionais e não políticas são FORMAS de produzir protagonismo — a faixa mede o NÍVEL, não a forma. Nenhuma pode ser exigida, e nenhuma por si só qualifica.',
     'FRONTEIRA PRINCIPAL — AGÊNCIA, cruzada com centralidade. Para SUBIR: as decisões precisam ALTERAR O RUMO, não só ocorrer. Para DESCER: a personagem está em cena mas o rumo é decidido por outros.',
     'SEPARADOR 7-8 × 9-10 — dentro do enquadramento × SOBRE o enquadramento. Não é fórmula e não é trajetória: é a MAGNITUDE do que as decisões alcançam. 7-8 = as decisões mudam a trajetória dela dentro de um enquadramento que ela não controla (Villains Are Destined to Die: o sistema do jogo; The Apothecary Diaries: a corte, sem poder institucional). 9-10 = as decisões mudam o ENQUADRAMENTO em si (The Villainess Lives Again; The Ember Knight: o gatilho não é dele, as respostas é que reorganizam).',
     'NÃO FAÇA: poder/força/competência = protagonismo (One-Punch Man) · presença em cena = agência (Under the Oak Tree) · exigir controle total para faixa alta (Villains: agência alta sob constrangimento) · exigir poder institucional (Apothecary) · exigir força física (The Ember Knight) · ler valência moral como protagonismo (o construto é de qualquer valência) · pontuar pela fase mais forte ou pela mais fraca (a banda é o nível representativo; uma fase não é uma banda) · tratar agência que CESSA como agência constrangida (constrangida é agir sob limite e cabe em 7-8; cessar é deixar de agir e entra na agregação como o nível baixo que é) · competência = agência ("ela resolve tudo sem esforço" é competência; resolver sem que a decisão custe ou altere o rumo não sobe faixa).'
   )
where slug = 'protagonist' and eval_type = 'IA';

update criteria set
  criteria = 'Humor',
  display_order = 8,
  description = 'Avalia o quanto o humor está presente no tom da obra.' || chr(10) || 'Considera se há apenas alívio cômico pontual ou se a comédia é parte frequente e importante da experiência.',
  ranges = json_build_array(
     '0-3 | Ausente: tom sério; a obra quase não emprega comédia.',
     '4-6 | Presente mas secundário: humor ocasional, alívio cômico pontual.',
     '7-8 | Significativo: a obra emprega humor com frequência; a comédia é parte importante do registro.',
     '9-10 | Onipresente: o registro cômico domina; a obra é construída para fazer rir o tempo todo. (Humor sombrio/sátira conta, mas o clima pesado o muta: mesmas piadas em clima leve pontuam mais alto.)'
   ),
  guidance = null
where slug = 'humor' and eval_type = 'IA';

update criteria set
  criteria = 'Drama',
  display_order = 9,
  description = 'Unipolar de intensidade. Quantidade, frequência, duração e importância do conflito emocional — AGNÓSTICO quanto à resolução.',
  ranges = json_build_array(
     '0-3 | Pouco conflito emocional; tensões pequenas, resolvidas na própria cena.',
     '4-6 | Conflito presente porém EPISÓDICO — não estrutura a experiência.',
     '7-8 | Conflito emocional RECORRENTE e importante, inclusive com progresso e catarse.',
     '9-10 | Conflito recorrente, duradouro e CENTRAL à experiência.'
   ),
  guidance = json_build_array(
     'FRONTEIRA PRINCIPAL — RECORRÊNCIA e importância do conflito. Para SUBIR: o conflito precisa VOLTAR e PESAR, não ser maior num momento. Para DESCER: o conflito passa a ser episódico ou resolvido em cena.',
     'ÂNCORAS: 9-10 What It Means to Be You (Drama alto + Angústia muito alta + Tragédia baixa), Villains Are Destined to Die — 7-8 Marry My Husband (Drama alto COM progresso e catarse) — 0-3 A Sign of Affection (manga) — stress: Kaguya-sama (Drama alto + Humor alto), Look Back (poucos conflitos + uma perda enorme).',
     'NÃO FAÇA: deixar a resolução abaixar Drama (Marry My Husband tem catarse e permanece alto) · um evento enorme = Drama alto (Look Back: poucos conflitos + uma perda enorme ⇒ isso é Tragédia, não Drama) · Humor alto exclui Drama alto (Kaguya-sama) · muito conflito = Angústia extrema (Betrayal of Dignity: são construtos diferentes) · ler final feliz como Drama baixo (agnóstico quanto à resolução).'
   )
where slug = 'drama' and eval_type = 'IA';

update criteria set
  criteria = 'Tragédia',
  display_order = 10,
  description = 'Avalia o peso de acontecimentos trágicos durante o desenvolvimento principal da história (não considera background nem acontecimentos no começo imediato da história).' || chr(10) || 'Considera perdas, separações, mortes, injustiças e sofrimento que acontecem no meio da obra e impactam diretamente os personagens principais.',
  ranges = json_build_array(
     '0-3 | Ausente: nenhuma perda irreversível nem luto relevante no desenvolvimento.',
     '4-6 | Presente mas secundária: sofrimento ou perdas sérias, porém isoladas ou reversíveis. Perda no CONTEXTO ESTABELECIDO (background/situação inicial — ex.: família morta antes do início) NÃO conta; só a DIREÇÃO da trama. Sofrimento psicológico prolongado SEM perda irreversível é drama, não tragédia.',
     '7-8 | Significativa: perdas irreversíveis (mortes, separações definitivas) na direção da trama que reconfiguram a história e marcam os protagonistas.',
     '9-10 | Onipresente: luto e perda irreversível permeiam a obra inteira; tom trágico constante, sensação de inevitabilidade.'
   ),
  guidance = null
where slug = 'tragedy' and eval_type = 'IA';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · Os dois legados saem do producer. 'Legado' é valor NOVO de eval_type — a coluna é texto
--     livre, sem constraint, e já convive com 'IA', 'User' e 'Gosto' (conferido na nuvem).
--     Escolhido por ser inequívoco: `sync-constants` e `criteria-guard` filtram eval_type='IA',
--     então qualquer valor fora disso os remove do producer; nomeá-lo 'Legado' evita que alguém
--     leia a linha como um critério de outra família.
-- ─────────────────────────────────────────────────────────────────────────────
update criteria set eval_type = 'Legado' where slug in ('fantasy_nobility', 'nobility');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · score_weights: o slot do cálculo passa de `fantasy_nobility` para `fantasy`.
--     🔴 Copia o ESTADO EXISTENTE, nunca um número escrito aqui: se alguém tiver mexido no peso
--     entre a escrita e a aplicação, é o valor DELE que viaja.
-- ─────────────────────────────────────────────────────────────────────────────
update score_weights novo
   set weight    = velho.weight,
       threshold = velho.threshold,
       is_active = velho.is_active
  from score_weights velho
 where velho.slug = 'fantasy_nobility'
   and novo.slug  = 'fantasy';

-- O legado sai do cálculo. `weight`/`threshold` ficam como estão: são registro histórico de
-- configuração, e zerá-los apagaria a informação de quanto ele pesava.
update score_weights set is_active = false where slug = 'fantasy_nobility';

-- `nobility` já está inativo (197) e permanece. Os dois novos entram DESLIGADOS: eles são
-- avaliados e exibidos, mas não entram na Nota.IA nem no vetor de 9.
insert into score_weights (slug, name, weight, threshold, is_active, display_order)
values ('setting_era', 'Ambientação Temporal', 0, null, false, 12),
       ('angst',       'Angústia',             0, null, false, 13)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · Instrumentação da deriva. Observabilidade, NÃO política: sem limiar, sem alarme e sem
--     rollback automático. Todas nullable, para que as 2.274 linhas antigas sigam legíveis.
-- ─────────────────────────────────────────────────────────────────────────────
alter table calibration_history add column if not exists fantasy_real_count integer;
alter table calibration_history add column if not exists fantasy_legacy_copy_count integer;
alter table calibration_history add column if not exists fantasy_real_ratio numeric;
alter table calibration_history add column if not exists scoring_criteria_signature text;

comment on column calibration_history.fantasy_real_count is
  'Obras ATIVAS cujo category_scores.fantasy tem source <> legacy_split_copy, no instante do recalc. Mede a substituição natural do seed da 197 por avaliação de verdade.';
comment on column calibration_history.fantasy_legacy_copy_count is
  'Obras ATIVAS cujo category_scores.fantasy ainda é o seed legacy_split_copy (cópia do fantasy_nobility).';
comment on column calibration_history.fantasy_real_ratio is
  'fantasy_real_count / (real + legacy). NULL quando não há nenhuma das duas — nunca divisão por zero.';
comment on column calibration_history.scoring_criteria_signature is
  'Os SCORING_CRITERION_SLUGS em vigor, em ordem, separados por vírgula. Sem isto não dá para saber se um cv_mae_expected pertence ao vetor com fantasy ou ao com fantasy_nobility.';

commit;
