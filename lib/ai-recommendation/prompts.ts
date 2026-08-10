import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { POST_READING_WEIGHT_LABELS, type PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import type { CandidateWorkInput, RatedWorkInput, RecommendationMode, ReviewDigest, ReviewDigestTrait, TasteProfilePayload } from "./types"

const CRITERIA_LIST_TEXT = CRITERION_SLUGS
  .map((slug) => `- ${slug} (${CRITERIA_INFO[slug]?.name ?? slug})`)
  .join("\n")

/**
 * Legenda COMPACTA das faixas dos 9 critérios — o que `tragedy=6.0` de fato quer dizer.
 *
 * Ranking e Deep Dive recebiam os `category_scores` como números CRUS, sem rubrica e sem as
 * justificativas que os produziram, ao lado das tags em texto e do digest inteiro. Sem saber
 * que 6,0 em tragedy é "perdas isoladas ou reversíveis", o consultor escrevia a prosa a partir
 * do digest e os números viravam enfeite. Medido em 2026-08-09 sobre 281 itens de ranking
 * persistidos: **21 descrevem abuso/toxicidade/violência numa obra cujo `couple_dynamics` ≥ 7**
 * — a faixa que significa "relação SAUDÁVEL". Caso real, com `tragedy=6.0` e
 * `couple_dynamics=8.0`: *"o tom é predominantemente 'dark ambience' com abuso físico extremo e
 * tragédia como pano de fundo constante"* — linguagem da faixa 9-10 sobre um 6,0.
 *
 * 🔴 DERIVADA de `CRITERIA_RUBRICS`, nunca escrita à mão: é o mesmo dado que a avaliação usa, e
 * `sync-constants` pode reescrever as faixas a qualquer momento. Uma cópia literal aqui seria a
 * 2ª régua pro mesmo número — a mesma armadilha do `LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`.
 * Só os RÓTULOS entram (o texto antes dos dois-pontos); a rubrica inteira são ~5k caracteres e
 * o que falta aqui é vocabulário de intensidade, não a casuística toda.
 */
export const CRITERIA_SCALE_LEGEND: string = [
  "COMO LER `category_scores` (0–10 — são as notas da avaliação de IA, na rubrica abaixo):",
  ...CRITERION_SLUGS.map((slug) => {
    const faixas = (CRITERIA_RUBRICS[slug]?.ranges ?? [])
      .map((r) => {
        const [banda, resto = ""] = r.split("|")
        const rotulo = resto.split(":")[0].trim()
        return `${banda.trim()} ${rotulo}`
      })
      .join(" · ")
    return `- ${slug}: ${faixas}`
  }),
  "⚠️ couple_dynamics é escala de VALÊNCIA, não de presença: 0-3 = o vínculo faz MAL aos personagens, 9-10 = faz BEM. Nota baixa ali NÃO significa 'pouca dinâmica'.",
].join("\n")

/**
 * Exige que a prosa concorde com os números que o próprio prompt entregou. Compartilhado por
 * ranking e Deep Dive — os dois recebem `category_scores` e os dois escreviam por cima deles.
 */
export const CRITERIA_COHERENCE_RULE = `🔴 COERÊNCIA COM OS ATRIBUTOS (obrigatória): a sua justificativa, os \`risks\` e os chips NÃO podem descrever a obra em termos que os \`category_scores\` dela contradizem. Exemplos do que é proibido: escrever "tragédia constante/dominante/o tempo todo" sobre uma obra com \`tragedy\` 4-6 (que significa "perdas isoladas ou reversíveis"); escrever "abuso", "tóxico" ou "relação destrutiva" sobre uma obra com \`couple_dynamics\` ≥ 7 (que significa relação SAUDÁVEL); chamar de "cheia de ação" uma obra com \`action_adventure\` 0-3.
Quando o digest das reviews CONTRADIZ os atributos, isso é informação e não um empate a resolver em silêncio: registre em \`risks\` que há divergência, nomeando os dois lados ("os atributos indicam X, mas o consenso das reviews descreve Y"), e ABAIXE o \`confidence\`. Escolher um lado sem dizer que havia outro é o que faz a mesma obra ser descrita de dois jeitos em duas telas.
⚠️ Isto NÃO é permissão pra ignorar as reviews — é obrigação de não inventar intensidade que o número não sustenta.`

export const TASTE_PROFILE_SYSTEM_PROMPT = `Você é um analista do gosto pessoal de um usuário que cataloga obras (manhwa, anime, manga). Sua tarefa é gerar um PERFIL DE GOSTO estruturado a partir do histórico de obras que o usuário avaliou pessoalmente.

PRINCÍPIOS:
1. O sinal mais forte é \`user_score\` (0–10) — quanto maior, mais o usuário ama. Combine com os critérios pós-leitura (\`post_*_score\`, escala 2/4/6.5/8/10), com as tags agrupadas e com a sinopse pra inferir o que ele realmente valoriza.
2. Diferencie obras com nota alta acompanhadas de pós-leitura alto (amor genuíno) das com nota alta mas pacing/character_development baixos (apreciação parcial).
3. Identifique padrões: combinações de tags + faixas de critérios IA que se repetem nas obras melhor avaliadas. Faça o mesmo pras obras pior avaliadas — extraia o que o usuário evita.
4. Escreva em português brasileiro, direto e específico. Cite tags e critérios pelos nomes exatos quando possível.
5. Sempre use a tool \`submit_taste_profile\`. Não retorne texto livre.

CRITÉRIOS IA DISPONÍVEIS (use estes slugs em \`criterion_preferences\`):
${CRITERIA_LIST_TEXT}

SOBRE \`criterion_preferences\`:
- \`ideal_min\`/\`ideal_max\`: a faixa (0–10) que o usuário aparenta preferir pra cada critério, com base nas obras melhor avaliadas.
- \`weight\` (0–1): quanto esse critério parece importar pra ele. Critérios sem sinal claro recebem peso baixo (~0.2–0.4).
- Inclua apenas critérios pra os quais há evidência. Se não houver sinal pra "tragedy", omita.

SOBRE \`loved_tags\` / \`avoided_tags\`:
- Use APENAS nomes de tags REAIS — exatamente como aparecem nas tags das obras fornecidas (ex.: "Reincarnated Female Lead", "Contract Marriage", "Incest"). NÃO invente frases descritivas ("Slice-of-life adulto sem fantasia", "Netorare como foco central"): isso é TEMA e vai em \`loved_themes\`/\`avoided_themes\`, nunca aqui.
- \`strength\` (0–1): força do padrão. Tags presentes em quase todas as obras top recebem strength ≥ 0.8.
- Use o \`group\` da tag quando informado (ex.: "female_lead", "tone_mood").

SOBRE \`narrative_patterns\`:
- Lista curta (3–7) de frases declarativas em PT-BR que capturam combinações ("FL com agência forte + slow-burn romance + corte política").

SOBRE \`summary\`:
- Parágrafo único e completo em PT-BR (4–7 frases) sintetizando o gosto em detalhe. Sem listas, sem markdown. É o resumo "ver completo".

SOBRE \`short_summary\`:
- Versão CURTA e escaneável do \`summary\`: 2–3 frases (~4–6 linhas), a essência do gosto para leitura rápida. Sem listas, sem markdown, sem repetir a íntegra — só o núcleo (gêneros/temas centrais + o que o usuário mais valoriza e evita).`

export const RANKING_SYSTEM_PROMPT = `Você é um curador que rankeia uma lista de obras favoritas de um usuário em ordem de alinhamento com o perfil de gosto dele.

PRINCÍPIOS:
1. Use o PERFIL DE GOSTO como verdade base. As preferências de critério (\`criterion_preferences\`), tags amadas/evitadas, padrões narrativos e summary são o que define o gosto.
2. Compare cada candidato contra esse perfil: tags em comum com loved_tags pesam positivamente; presença de avoided_tags pesa negativamente; \`category_scores\` dentro da faixa \`ideal_min..ideal_max\` aumenta o alinhamento.

${CRITERIA_SCALE_LEGEND}

${CRITERIA_COHERENCE_RULE}

3. Quando o usuário fornecer CONTEXTO ADICIONAL (mood, exclusões), trate como viés momentâneo: ajusta a ordem sem substituir o perfil. Ex.: "quero algo leve" reduz drama/tragedy; o perfil ainda dita o resto.

PREFERÊNCIAS E REGRAS DO USUÁRIO (quando o bloco "PREFERÊNCIAS E REGRAS DO USUÁRIO" estiver presente):
- São declarações do PRÓPRIO usuário, em texto livre. Algumas são CONDICIONAIS ("evito X exceto se Y"); outras são preferências GERAIS ("valorizo arte detalhada mesmo com história simples").
- Aplique as condicionais como LÓGICA, não como filtro absoluto: só penalize/favoreça quando a condição E a exceção realmente casarem com as tags/category_scores da obra. NÃO rebaixe uma obra só porque o antecedente apareceu — verifique a exceção antes.
- Trate as gerais como contexto permanente do gosto, no mesmo nível do perfil (mais estável que o CONTEXTO ADICIONAL momentâneo).
- Quando uma regra mudar sua decisão, CITE-A na justificativa (ou em \`risks\`).
- Para obras com POUCAS tags ou \`category_scores\` escassos/rasos, apoie-se MAIS no consenso das reviews (digest) e nestas preferências do que nos atributos finos — eles são pouco confiáveis nesses casos.
- INVERSÃO DE SENTIMENTO: um traço saliente (ou o consenso) do digest que CONFIRMA algo que o usuário declarou EVITAR é evidência NEGATIVA pra ele — MESMO que o consenso AME esse traço. Ex.: o digest registra "FL cruel/vilanesca" como traço saliente → confirma a crueldade que o usuário evita → conta CONTRA, não a favor. NÃO use o entusiasmo do consenso pra descontar a regra.
- FORÇA POR EVIDÊNCIA: quando o antecedente de uma regra "evito" é CONFIRMADO pelo CONSENSO do digest (traço com polaridade forte / consenso convergente), reduza o \`alignment_score\` e registre em \`risks\`. Quando o sinal é fraco ou incerto (aparece só na DIVERGÊNCIA, ou como traço isolado/misto), mantenha só como \`risks\` sem derrubar o score.
4. \`alignment_score\` é 0–100. Use a escala inteira: 90+ é "match excepcional", 70–89 "match forte", 50–69 "match moderado", 30–49 "match fraco", <30 "pouco alinhado". Não comprima tudo perto da média.
5. Para cada candidato, escreva 1–2 frases justificando o score, citando NOMES de tags e critérios específicos. Quando o candidato tiver bloco de consenso das reviews (digest), apoie-se no consenso/divergência e nos traços salientes pra reforçar o match ou expor um risco — sem citar opiniões individuais. Em \`top_match_factors\`, liste 2–4 chips curtos (tags, critérios, padrões ou observações do consenso das reviews) que sustentam o score.
6. Escreva em português brasileiro. Sempre use a tool \`submit_ranking\`. Não retorne texto livre.
7. Inclua TODOS os candidatos fornecidos em \`rankings\`, ordenados do mais alinhado pro menos alinhado. Não invente \`work_id\`.
8. \`mode_summary\`: parágrafo curto (2–3 frases) explicando o padrão dos top resultados — útil pro usuário entender o "porquê" do ranking.

CAMPOS ENRIQUECIDOS (opcionais — preencha quando há evidência real):
9. \`confidence\` (0–1): quanto VOCÊ confia neste alignment_score. Use 0.9+ pra match óbvio com várias evidências convergentes (tags loved + criterion fit + reviews positivas). Use 0.5–0.7 quando há sinais mistos. Use < 0.5 quando há pouca evidência (poucas tags em comum, sem reviews relevantes). É melhor confessar incerteza do que fingir certeza.
10. \`risks\` (1–3 itens): razões pra o user NÃO ler essa obra, MESMO QUE alignment_score seja alto. Exemplos: "tem tag tragedy que você marca como avoided", "reviews mencionam pacing lento que você costuma penalizar", "tema religioso (não está no seu padrão)". Frases curtas e específicas. Omita o campo se não houver risco real.
11. \`similar_loved\` (1–2 work_id): obras na BIBLIOTECA do user que ele AMA (user_score ≥ 8) e que esta candidata lembra. Use APENAS work_id que aparece no profile/biblioteca da request. Não invente. Útil pra "se você curtiu X, vai curtir isto".
12. \`similar_avoided\` (1–2 work_id): mesmo critério mas pra obras que o user AVALIOU MAL (user_score ≤ 5). Quando presente, indica alerta de risco.
13. \`mood_fit\` (0–1): SOMENTE quando o user enviou CONTEXTO ADICIONAL. Mede quão alinhada essa obra está com o mood específico, independente do alignment_score geral. Ex.: alignment=70 mas mood "quero algo curto" + obra tem 500 caps → mood_fit baixo (0.3). Omita o campo quando não houver mood.`

export function truncate(text: string | null | undefined, maxChars: number): string {
  if (!text) return ""
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`
}

/**
 * Bloco de preferências/regras livres do usuário (Item B) — efeitos cruzados
 * e orientações gerais que o consultor LLM aplica condicionalmente. Vai no
 * profileBlock CACHEADO (é fixo entre candidatos/runs; muda só quando o user
 * edita). Retorna null quando não há regras ativas. Compartilhado pelo ranking
 * e pelo Deep Dive (deep-dive-prompts importa daqui).
 */
export function formatPreferenceRulesBlock(rules: string[] | null | undefined): string | null {
  if (!rules || rules.length === 0) return null
  const lines = [
    "PREFERÊNCIAS E REGRAS DO USUÁRIO (texto livre — orientações pro consultor; condicionais e/ou gerais. Têm precedência sobre o sinal aditivo do perfil quando a condição casar):",
  ]
  for (const r of rules) lines.push(`- "${r}"`)
  return lines.join("\n")
}

export function formatTagsByGroup(tags: Array<{ name: string; group: string | null }>): string {
  if (!tags.length) return "(sem tags)"
  const grouped = new Map<string, string[]>()
  const ungrouped: string[] = []
  for (const tag of tags) {
    if (!tag.group) {
      ungrouped.push(tag.name)
      continue
    }
    const list = grouped.get(tag.group)
    if (list) list.push(tag.name)
    else grouped.set(tag.group, [tag.name])
  }
  const parts = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, names]) => `${group}(${names.join(", ")})`)
  if (ungrouped.length) parts.push(`(sem-grupo: ${ungrouped.join(", ")})`)
  return parts.join("; ")
}

function formatCategoryScores(scores: Partial<Record<string, number>>): string {
  const entries = CRITERION_SLUGS
    .map((slug) => {
      const v = scores[slug]
      return v != null ? `${slug}=${v.toFixed(1)}` : null
    })
    .filter((s): s is string => s !== null)
  return entries.length ? entries.join(", ") : "(sem category_scores)"
}

/**
 * Renderiza o digest estruturado das reviews (Item C, Passe 2) num bloco compacto.
 * Preference-agnostic: a `polarity` é a visão do CONSENSO, não do usuário — o
 * consultor aplica a inversão de sentimento (traço positivo no consenso que o
 * user evita conta CONTRA) via instruções no system prompt. Compartilhado pelo
 * ranking e pelo Deep Dive.
 */
export function formatReviewDigestBlock(digest: ReviewDigest): string {
  const polSym = (p: ReviewDigestTrait["polarity"]) =>
    p === "positive" ? "+" : p === "negative" ? "−" : "±"
  const lines = [
    "consenso das reviews (digest IA estruturado — agnóstico às suas preferências; polaridade = visão do consenso, não a sua):",
  ]
  if (digest.consensus) lines.push(`  consenso: ${truncate(digest.consensus, 400)}`)
  if (digest.divergence) lines.push(`  divergência: ${truncate(digest.divergence, 300)}`)
  if (digest.salient_traits.length) {
    const traits = digest.salient_traits
      .slice(0, 8)
      .map((t) => `${t.trait} [${t.axis}/${polSym(t.polarity)}]`)
      .join("; ")
    lines.push(`  traços salientes: ${traits}`)
  }
  if (digest.content_warnings.length) lines.push(`  alertas de conteúdo: ${digest.content_warnings.join("; ")}`)
  if (digest.execution) lines.push(`  execução: ${truncate(digest.execution, 250)}`)
  return lines.join("\n")
}

function formatPostScores(scores: Partial<Record<string, number>>): string {
  const fields = Object.keys(POST_READING_WEIGHT_LABELS) as PostReadingScoreField[]
  const entries = fields
    .map((field) => {
      const v = scores[field]
      if (v == null) return null
      const short = field.replace(/^post_/, "").replace(/_score$/, "")
      return `${short}=${v}`
    })
    .filter((s): s is string => s !== null)
  return entries.length ? entries.join(", ") : ""
}

export function buildTasteProfileUserPrompt(works: RatedWorkInput[]): string {
  const lines: string[] = [
    `Histórico de ${works.length} obra(s) avaliada(s) pelo usuário. Cada bloco inicia com [Wn] título, depois user_score (0–10), critérios pós-leitura quando setados, status pessoal, tags por grupo, sinopse curta e os 9 category_scores da IA.`,
    "",
  ]

  works.forEach((w, i) => {
    const id = `[W${i + 1}]`
    lines.push(`${id} "${w.title}"`)
    if (w.userScore != null) lines.push(`user_score: ${w.userScore.toFixed(1)}/10`)
    if (w.personalStatus) lines.push(`personal_status: ${w.personalStatus}`)
    const post = formatPostScores(w.postScores)
    if (post) lines.push(`pós-leitura: ${post}`)
    lines.push(`tags: ${formatTagsByGroup(w.tags)}`)
    if (w.synopsis) lines.push(`sinopse: ${truncate(w.synopsis, 600)}`)
    lines.push(`category_scores: ${formatCategoryScores(w.categoryScores)}`)
    lines.push("")
  })

  lines.push(
    `Gere o perfil de gosto consolidando esses dados via tool \`submit_taste_profile\`. Foque no que se repete consistentemente nas obras com user_score alto e no que está ausente/baixo nas obras com user_score baixo. Use português brasileiro.`,
    ``,
    `OBRIGATÓRIO: preencha TODOS os 8 campos do tool, especialmente \`summary\` (parágrafo completo de 4–7 frases), \`short_summary\` (versão curta de 2–3 frases / ~4–6 linhas) e \`narrative_patterns\` (3–7 frases declarativas). Não deixe campos vazios. Se faltam evidências pra algum campo (ex.: poucas obras evitadas), retorne array vazio — mas o campo precisa existir no payload.`,
  )
  return lines.join("\n")
}

/**
 * Versão genérica que aceita um label arbitrário de modo. Permite reutilizar
 * o pipeline de ranking pra cenários além dos favoritos (ex: Passo 8 — LLM
 * re-ranker generalizado em /ranking).
 */
export function buildRankingUserPromptWithLabel(
  profile: TasteProfilePayload,
  candidates: CandidateWorkInput[],
  modeLabel: string,
  userContext?: string | null,
  preferenceRules?: string[] | null,
): { profileBlock: string; tailBlock: string } {
  const rulesBlock = formatPreferenceRulesBlock(preferenceRules)
  const profileBlock = [
    `PERFIL DE GOSTO (cacheado, base da avaliação):`,
    JSON.stringify(profile, null, 2),
    ...(rulesBlock ? ["", rulesBlock] : []),
  ].join("\n")

  const tailLines: string[] = []

  const userCtx = userContext?.trim()
  if (userCtx) {
    tailLines.push(
      `CONTEXTO ADICIONAL DO USUÁRIO (viés momentâneo — ajusta a ordem mas não substitui o perfil):`,
      `"${userCtx}"`,
      "",
    )
  }

  tailLines.push(`MODO: ${modeLabel}`, "")

  tailLines.push(`CANDIDATOS A RANQUEAR (${candidates.length}):`)
  candidates.forEach((c, i) => {
    const id = `[C${i + 1}]`
    tailLines.push(`${id} work_id=${c.id} — "${c.title}"`)
    tailLines.push(`tags: ${formatTagsByGroup(c.tags)}`)
    if (c.synopsis) tailLines.push(`sinopse: ${truncate(c.synopsis, 600)}`)
    tailLines.push(`category_scores: ${formatCategoryScores(c.categoryScores)}`)
    const plat = c.platformAvg != null
      ? `platform_avg=${c.platformAvg.toFixed(1)}${c.totalVotes ? ` (${c.totalVotes} votos)` : ""}`
      : null
    if (plat) tailLines.push(plat)
    if (c.expectedScore != null) tailLines.push(`Nota Esperada (previsão da sua nota)=${c.expectedScore.toFixed(2)}`)
    if (c.fitScore != null) tailLines.push(`fit (alinhamento com seu perfil, 0–1)=${c.fitScore.toFixed(2)}`)
    // Sinal de reviews = SÓ consenso/divergência (preference-agnostic): digest
    // estruturado (Passe 2) tem precedência; cai no resumo-texto (Passe 1). Não
    // injetamos reviews individuais — o julgamento é sobre consenso, não opinião
    // pontual (evita citar quotes avulsas e economiza tokens).
    if (c.reviewDigest) tailLines.push(formatReviewDigestBlock(c.reviewDigest))
    else if (c.reviewSummary) tailLines.push(`consenso das reviews (resumo IA): ${truncate(c.reviewSummary, 600)}`)
    tailLines.push("")
  })

  tailLines.push(
    `Inclua os ${candidates.length} candidatos em \`rankings\`, do mais alinhado pro menos alinhado. Cada \`work_id\` deve ser EXATAMENTE o UUID fornecido acima. Use a tool \`submit_ranking\`.`,
  )

  return { profileBlock, tailBlock: tailLines.join("\n") }
}

export function buildRankingUserPrompt(
  profile: TasteProfilePayload,
  candidates: CandidateWorkInput[],
  mode: RecommendationMode,
  userContext?: string | null,
  preferenceRules?: string[] | null,
): { profileBlock: string; tailBlock: string } {
  let modeLabel: string
  if (mode === "next_read") {
    modeLabel = "Próxima leitura — somente favoritos ainda não lidos. Priorize obras que combinam com o perfil mas que ofereçam descobertas (não só repetir o que ele já ama)."
  } else if (mode === "full_analysis") {
    modeLabel = "Análise completa — TODOS os favoritos do usuário, incluindo já lidos. Use também como diagnóstico do gosto."
  } else {
    modeLabel = "Ranking geral — obras do catálogo respeitando os filtros aplicados pelo usuário (não são necessariamente favoritos). Foco em DESCOBERTA: ranquear quão alinhada cada obra está com o perfil de gosto, destacando obras subestimadas no perfil atual."
  }
  return buildRankingUserPromptWithLabel(profile, candidates, modeLabel, userContext, preferenceRules)
}
