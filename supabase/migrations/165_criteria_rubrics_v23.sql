-- 165_criteria_rubrics_v23.sql
-- Reescreve as rubricas (ranges) dos critérios IA para a v23. Decisões congeladas
-- na conversa de 2026-07-25 (ver REGISTRO abaixo). Princípios:
--   · escala NEUTRA de intensidade (0-3 ausente → 9-10 onipresente), exceto
--     couple_dynamics, que é VALÊNCIA (destrutiva → construtiva);
--   · topo 9-10 = SATURAÇÃO ("onipresente"), não primazia ("define a obra"),
--     pra critérios não se excluírem;
--   · romance mede CONTEÚDO retratado, não "amor como tema";
--   · protagonist mede PRESENÇA/agência, não qualidade;
--   · tragédia = gravidade × irreversibilidade, na direção da trama;
--   · adult_content NÃO é tocado aqui (já reescrito na migration 164 / v22).
--
-- As regras interpretativas (2 grupos, prática-não-teoria, sinopse em 3 partes,
-- blocos por critério) ficam no SYSTEM_PROMPT (lib/ai-evaluation/service.ts), não
-- na rubrica. Aqui é só o texto das faixas.
--
-- ⚠️ Rode `npm run sync-constants` depois de aplicar.
-- `ranges` é json → jsonb_set + to_jsonb por índice (mesmo padrão das migs 063/164).

-- ── romance (FATO · conteúdo retratado) ──────────────────────────────────────
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente: nenhum conteúdo romântico se desenvolvendo — sem casal, sem interação/tensão romântica. "Amor" como TEMA, sem romance retratado (um obcecado por algo inalcançável, sem interação), é esta faixa.'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundário: existe um fio romântico, mas pouco desenvolvido — poucas cenas/beats; acessório para quem procura romance.'::text)),
  '{2}', to_jsonb('7-8 | Substancial: a relação se desenvolve com cenas e beats claros (atração, tensão, aproximação, declaração). Slow burn com foco romântico é esta faixa (desenvolve, só gradual).'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: desenvolvimento e cenas românticas permeiam a obra; a experiência é dominada pelo romance do casal.'::text))
  ::json WHERE slug = 'romance' AND eval_type = 'IA';

-- ── couple_dynamics (SENTIMENTO · valência) ─────────────────────────────────
UPDATE criteria SET criteria = 'Dinâmica entre Protagonistas' WHERE slug = 'couple_dynamics' AND eval_type = 'IA';
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Destrutiva: dano ativo/não-consensual DENTRO dos vínculos centrais — abuso, manipulação, sofrimento contínuo de quem é próximo. Devoção a um abusador não-arrependido também é 0-3 (autodestrutiva). Dinâmica não-tradicional CONSENSUAL (BDSM, posse, ciúme) com tom romântico/cômico NÃO entra aqui. Crueldade com antagonistas que a merecem NÃO rebaixa.'::text)),
  '{1}', to_jsonb('4-6 | Conflituosa ou ambivalente: conflitos recorrentes, mal-entendidos prolongados, comunicação falha; ou conduta mista nos vínculos centrais (ajuda uns, prejudica outros).'::text)),
  '{2}', to_jsonb('7-8 | Saudável: relação/conduta majoritariamente construtiva, respeito mútuo, conflitos pontuais resolvidos.'::text)),
  '{3}', to_jsonb('9-10 | Construtiva: parceria, apoio mútuo, comunicação e crescimento conjunto. Dois personagens danificados que se curam e se entendem (cura ENCENADA, cedo na obra) são esta faixa.'::text))
  ::json WHERE slug = 'couple_dynamics' AND eval_type = 'IA';

-- ── fantasy_nobility (FATO) ─────────────────────────────────────────────────
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente ou estético: mundo comum, ou fantasia/nobreza só de fachada (é "príncipe", mas isso não importa).'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundário: elementos de fantasia/nobreza influenciam partes da obra, mas não a organizam.'::text)),
  '{2}', to_jsonb('7-8 | Estrutural: magia, política nobre, aristocracia, reencarnação ou regras do mundo moldam os conflitos principais.'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: magia/nobreza/regras do mundo aparecem constantemente e sustentam quase tudo que acontece.'::text))
  ::json WHERE slug = 'fantasy_nobility' AND eval_type = 'IA';

-- ── action_adventure (FATO) ─────────────────────────────────────────────────
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente: cotidiano, sem conflito externo relevante (slice of life).'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundário: alguns eventos de tensão/ação (inclui perseguição, fuga, competição, intriga política com risco real), mas o foco é outro.'::text)),
  '{2}', to_jsonb('7-8 | Significativa: situações de ação/risco marcantes e frequentes, ou raras mas de alto risco; ritmo acelerado.'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: ação, perigo e eventos de grande escala são constantes e intensos, quase sem respiro cotidiano.'::text))
  ::json WHERE slug = 'action_adventure' AND eval_type = 'IA';

-- ── protagonist (FATO · presença/agência, NÃO qualidade) ────────────────────
UPDATE criteria SET description = 'Avalia o quanto o protagonista se destaca e impacta a história — presença em cena e AGÊNCIA (decisões que movem a trama). NÃO avalia qualidade: se é simpático, bem escrito ou agradável. Mary Sues, OPs, FLs frias/insensíveis/inconsistentes, vilões marcantes têm presença FORTE, não fraca.'
  WHERE slug = 'protagonist' AND eval_type = 'IA';
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Presença mínima: sem agência, decisões irrelevantes, substituível por outro personagem sem mudar a história.'::text)),
  '{1}', to_jsonb('4-6 | Presença moderada: conduz a história e tem personalidade reconhecível, mas não domina as cenas.'::text)),
  '{2}', to_jsonb('7-8 | Presença forte: agência clara, decisões movem a trama, personalidade marcante — mesmo se polêmica (Mary Sue, OP, insensível, inconsistente CONFIRMAM presença forte, não fraca).'::text)),
  '{3}', to_jsonb('9-10 | Presença dominante: no centro de quase todas as cenas e decisões; sustentaria o interesse mesmo sem plot.'::text))
  ::json WHERE slug = 'protagonist' AND eval_type = 'IA';

-- ── humor (SENTIMENTO) ──────────────────────────────────────────────────────
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente: tom sério; a obra quase não emprega comédia.'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundário: humor ocasional, alívio cômico pontual.'::text)),
  '{2}', to_jsonb('7-8 | Significativo: a obra emprega humor com frequência; a comédia é parte importante do registro.'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: o registro cômico domina; a obra é construída para fazer rir o tempo todo. (Humor sombrio/sátira conta, mas o clima pesado o muta: mesmas piadas em clima leve pontuam mais alto.)'::text))
  ::json WHERE slug = 'humor' AND eval_type = 'IA';

-- ── drama (SENTIMENTO) ──────────────────────────────────────────────────────
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente: pouco conflito emocional; problemas simples e de resolução rápida.'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundário: conflitos emocionais existem, mas controlados. (Fricção romântica leve — ciúme, mal-entendido do casal — não é drama por si só.)'::text)),
  '{2}', to_jsonb('7-8 | Significativo: conflitos emocionais profundos e recorrentes movem a obra.'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: carga emocional intensa e constante do início ao fim. Drama = intensidade E DURAÇÃO do conflito emocional (que PODE se resolver) — distinto de tragédia (gravidade e irreversibilidade das perdas).'::text))
  ::json WHERE slug = 'drama' AND eval_type = 'IA';

-- ── tragedy (SENTIMENTO · gravidade × irreversibilidade, na direção da trama) ─
UPDATE criteria SET ranges = jsonb_set(jsonb_set(jsonb_set(jsonb_set(ranges::jsonb,
  '{0}', to_jsonb('0-3 | Ausente: nenhuma perda irreversível nem luto relevante no desenvolvimento.'::text)),
  '{1}', to_jsonb('4-6 | Presente mas secundária: sofrimento ou perdas sérias, porém isoladas ou reversíveis. Perda no CONTEXTO ESTABELECIDO (background/situação inicial — ex.: família morta antes do início) NÃO conta; só a DIREÇÃO da trama. Sofrimento psicológico prolongado SEM perda irreversível é drama, não tragédia.'::text)),
  '{2}', to_jsonb('7-8 | Significativa: perdas irreversíveis (mortes, separações definitivas) na direção da trama que reconfiguram a história e marcam os protagonistas.'::text)),
  '{3}', to_jsonb('9-10 | Onipresente: luto e perda irreversível permeiam a obra inteira; tom trágico constante, sensação de inevitabilidade.'::text))
  ::json WHERE slug = 'tragedy' AND eval_type = 'IA';
