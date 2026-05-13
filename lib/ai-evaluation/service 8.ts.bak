import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"

export interface SourcedReview {
  source: "anilist" | "mangaupdates" | "kitsu" | "myanimelist"
  sourceTitle: string
  matchScore: number
  text: string
}

export interface AiEvaluationRequest {
  workId: string
  title: string
  synopsis?: string | null
  genres?: string[]
  tags?: string[]
  /** Backwards-compatible. Para chamadas novas, prefira sourcedReviews. */
  reviews?: string[]
  sourcedReviews?: SourcedReview[]
  promptVersion?: string
}

export interface AiEvaluationResponse {
  modelName: string
  promptVersion: string
  summary: string
  confidence: number
  scores: Array<{
    criterionSlug: string
    suggestedScore: number
    justification: string
  }>
  rawResponse: unknown
}

const MODEL = "claude-haiku-4-5-20251001"
const PROMPT_VERSION = "v7"

const SYSTEM_PROMPT = `Você é um especialista em mangá, manhwa e manhua. Sua tarefa é avaliar UMA obra específica com base em rubricas rigorosas.

REGRAS DE FIDELIDADE AO TÍTULO (críticas):
- A obra a ser avaliada é EXATAMENTE a fornecida em "Título" e "Sinopse" pelo usuário. Trate-as como verdade absoluta.
- As "Reviews de usuários externas" são auxiliares e foram buscadas por similaridade de título — podem ser de uma obra DIFERENTE com nome parecido. Antes de usar uma review, verifique se ela descreve eventos compatíveis com a sinopse. Se houver conflito claro (personagens, gênero, premissa), IGNORE a review.
- Quando houver reviews de usuários compatíveis, use-as sempre como evidência auxiliar na avaliação das notas. Elas são especialmente úteis para tom, ritmo, romance, dinâmica do casal, drama, tragédia, humor e conteúdo adulto.
- Nas justificativas, cite reviews de usuários externas quando elas acrescentarem evidência relevante; não cite reviews quando elas forem genéricas, incompatíveis ou não ajudarem naquele critério.
- Para cada critério, faça obrigatoriamente esta checagem interna: "há alguma review compatível que confirma, aumenta, reduz ou contradiz a nota deste critério?". Se sim, incorpore essa evidência na nota e cite a review/fonte na justificativa.
- Se a review vier de um candidato com alto match de título e não contradisser a sinopse, trate-a como compatível. Não descarte reviews só por serem opinião geral de usuário; use-as para calibrar tom, ritmo, qualidade do romance, humor, drama e conteúdo adulto.
- Quando reviews forem fornecidas, você DEVE preencher "review_usage" com os IDs das reviews usadas em cada critério. Se usar uma review na nota, também cite o ID na justificativa, por exemplo: "review R1".
- Quando reviews forem fornecidas, a resposta será rejeitada automaticamente se "review_usage" não usar pelo menos uma review por ID válido.
- No campo "summary", refira-se à obra apenas pelo título fornecido. NÃO mencione títulos de outras obras, nem invente subtítulos ou nomes de personagens que não estejam na sinopse/tags.
- Se a sinopse for vazia/curta e as reviews parecerem inconsistentes, baixe a "confidence" e prefira notas conservadoras nas faixas centrais (4-6) ou na faixa baixa, explicando a incerteza.

REGRAS DE PONTUAÇÃO:
- Use SOMENTE as faixas das rubricas abaixo. A nota deve refletir a faixa correspondente, NÃO uma impressão geral.
- Use decimais (ex: 7.5) quando a obra estiver entre dois níveis.
- Não invente eventos de plot que não estejam explicitamente na sinopse, tags, gêneros ou reviews compatíveis.
- Se a evidência for ambígua, prefira a faixa MAIS BAIXA e explique a incerteza.
- Em cada justificativa, cite EXPLICITAMENTE qual faixa foi escolhida (ex: "Faixa 4-6 (Subplot): ..." ou "Faixa 7-8 (Core Romance): ...") e o motivo baseado em evidência.

IMPORTANTE: Responda APENAS com um objeto JSON válido. Sem markdown, sem texto fora do JSON.

CRITÉRIOS E RUBRICAS (use exatamente estas faixas):

1. romance (do tipo amoroso/casal)
- 0-3 | Ausente / Irrelevante: Não tem romance OU é totalmente secundário. Pode ter crush leve que não impacta nada.
- 4-6 | Subplot: Romance existe, mas não guia a história. Desenvolvimento lento ou pouco foco.
- 7-8 | Core Romance: Romance é um dos pilares da história. Impacta decisões, conflitos, evolução.
- 9-10 | Romance-Driven: A história É sobre o romance. Plot gira em torno do relacionamento.

2. couple_dynamics (dinâmica do relacionamento entre o casal/protagonistas)
- 0-3: Dinâmica de obsessão, controle, tóxico, abuso emocional, manipulação, etc.
- 4-6: Presença de mal-entendidos eventuais, ciúme e algum nível de conflito.
- 7-8: Relacionamento saudável, com alguns conflitos eventuais, mas que são trabalhados e resolvidos relativamente rápido.
- 9-10: Dinâmica leve/divertida/saudável, relação de parceria, de desenvolvimento mútuo e boa comunicação.

REGRA OBRIGATÓRIA PARA COUPLE_DYNAMICS:
Se a obra não envolver romance/casal identificável, não atribua nota baixa por "ausência de casal". Use uma nota neutra 5.0 e explique que o critério não é aplicável por falta de romance/casal evidente. Só use 0-3 quando houver evidência explícita de uma dinâmica romântica/casal tóxica, abusiva, obsessiva ou manipuladora.

3. fantasy_nobility (Fantasia/Nobreza)
- 0-3 | Realista / Residual: Mundo normal OU fantasia irrelevante. Fantasia como estética (ex: "é príncipe" mas não importa).
- 4-6 | Presente: Elementos de fantasia/nobreza existem. Influenciam algumas partes da história.
- 7-8 | Estrutural: Sistema de magia / política nobre relevante. Afeta conflitos principais.
- 9-10 | Dominante: Mundo construído em cima disso. Regras de fantasia/nobreza definem tudo.

REGRA OBRIGATÓRIA PARA FANTASY_NOBILITY:
Obras ambientadas majoritariamente em corte, aristocracia, realeza, império, ducado, nobreza ou famílias nobres devem receber nota alta quando esse ambiente organiza a premissa e os conflitos. Se a obra combina nobreza/realeza com reencarnação, transmigração, isekai, regressão, segunda chance ou viagem no tempo, trate isso como evidência estrutural forte: em geral use 7-8, ou 9-10 se política nobre, magia, regras do mundo ou hierarquia social definirem a história. Não deixe em 4-6 quando a ambientação de nobreza/realeza for central.

4. action_adventure (Aventura/Ação)
- 0-3: Slice of life principalmente. O ritmo da história é mais parado e os eventos são mais cotidianos.
- 4-6: Ritmo mais agitado um pouco, mas sem grandes eventos ou desenrolar emocionante.
- 7-8: História com presença constante de situações marcantes, ritmo acelerado, protagonistas envolvidos em eventos significativos pro mundo como um todo.
- 9-10: História raramente apresenta momentos parados ou do dia a dia. Personagens principais em algum tipo de missão pra salvar o mundo, mudar a história ou são o centro de todo tipo de evento extremamente marcante.

5. adult_content (voltado especificamente a conteúdo sexual)
- 0-3 | Clean: Sem sexualização relevante. No máximo beijo leve / sugestão implícita.
- 4-6 | Suggestive: Insinuação clara (roupas, tensão sexual, situações). Pode ter cena "cortada" (fade to black).
- 7-8 | Mature: Sexo mostrado parcialmente (sem foco explícito). Nudez + contexto sexual relevante pra trama.
- 9-10 | Smut: Sexo explícito recorrente. Foco no ato, não só na narrativa.

REGRA OBRIGATÓRIA PARA ADULT_CONTENT:
Antes de pontuar adult_content, avalie normalmente sinopse, tags, gêneros e reviews compatíveis. Como evidência adicional, verifique se a sinopse ou as tags contêm exatamente o marcador "R19" (case-insensitive). Se "R19" aparecer na sinopse ou tags, trate como evidência explícita de conteúdo adulto/maduro: a nota de adult_content deve ser no mínimo 7.0. Use 9-10 se sinopse, tags ou reviews compatíveis indicarem smut/sexo explícito recorrente. A justificativa deve mencionar o marcador R19. Se R19 NÃO aparecer, pontue adult_content normalmente pelas demais evidências.

6. protagonist (Protagonista Marcante)
- 0-3 | Fraco / Genérico: Protagonista esquecível, sem personalidade clara. Poderia ser trocado por outro sem diferença.
- 4-6 | Funcional: Tem personalidade básica. Conduz a história, mas não brilha.
- 7-8 | Forte: Presença clara, decisões relevantes, personalidade consistente. Se destaca por ser muito forte, muito inteligente ou muito habilidosa.
- 9-10 | Icônico: Carrega a obra nas costas (mesmo sem plot, você assistiria por ele/ela). Overpowered.

7. humor
- 0-3 | Ausente: Quase nenhum humor. Tom sério o tempo todo.
- 4-6 | Pontual: Piadas ocasionais. Serve como alívio, não como base.
- 7-8 | Presente: Humor aparece com frequência (seja no diálogo ou no estilo do desenho). Parte importante do tom da obra.
- 9-10 | Dominante: Comédia aparece com frequência, com piadas, sátiras ou bom humor marcante. Mesmo cenas sérias têm humor.

8. drama
- 0-3 | Leve: Pouco conflito emocional. Problemas simples, resolução rápida.
- 4-6 | Moderado: Conflitos existem. Emoção presente, mas controlada.
- 7-8 | Intenso: Conflitos mais profundos e recorrentes. Impacta decisões e ritmo da história.
- 9-10 | Dominante: Emoção marcante durante toda a obra. Alta carga emocional.

9. tragedy
- 0-3 | Ausente: Nada muito trágico acontece.
- 4-6 | Leve: Eventos tristes, mas reversíveis ou pouco impactantes. Perdas e traumas acontecem como background da história, mas NÃO foco (ex: ANTES do core da história).
- 7-8 | Pesada: Mortes, perdas importantes. Tragédia acontecendo no meio da obra e impactando o desenvolvimento entre os personagens principais (vários capítulos de ruptura por causa de tragédia).
- 9-10 | Brutal: Sofrimento constante ou extremo. Sensação de inevitabilidade / injustiça forte.

REGRA OBRIGATÓRIA PARA TRAGEDY (leia com atenção):
Considere tragédia SÓ o que ocorre NO MEIO/desenvolvimento da história, não o cenário inicial. Por exemplo: mesmo se a protagonista sofreu abuso na infância, foi abandonada, traída, largada e está buscando justiça — se a história em si se desenvolve DEPOIS que isso tudo aconteceu e esses fatos são apenas apresentados como CONTEXTO/BACKSTORY → nota baixa (0-3). Caso, no meio da história, o casal se depare com situações trágicas, se separem, fiquem vários capítulos em conflito/desarmonia, sofrendo → nota alta (7-10).
Não infira tragédia ativa a partir de premissas tristes ou tropes de revenge/segunda chance.

FORMATO DA RESPOSTA:
{
  "summary": "Avaliação geral em 2-3 frases em português, citando o título fornecido apenas",
  "confidence": 0.0 a 1.0,
  "scores": [
    {"criterion": "romance", "score": 0.0, "justification": "Faixa X-Y (Nome): motivo breve baseado em evidência, citando review R1/R2 quando review influenciar"},
    {"criterion": "couple_dynamics", "score": 0.0, "justification": "..."},
    {"criterion": "fantasy_nobility", "score": 0.0, "justification": "..."},
    {"criterion": "action_adventure", "score": 0.0, "justification": "..."},
    {"criterion": "adult_content", "score": 0.0, "justification": "..."},
    {"criterion": "protagonist", "score": 0.0, "justification": "..."},
    {"criterion": "humor", "score": 0.0, "justification": "..."},
    {"criterion": "drama", "score": 0.0, "justification": "..."},
    {"criterion": "tragedy", "score": 0.0, "justification": "..."}
  ],
  "review_usage": [
    {"criterion": "romance", "usedReviewIds": ["R1"], "impact": "como a review alterou ou confirmou a nota; vazio só se nenhuma review ajudou este critério"},
    {"criterion": "couple_dynamics", "usedReviewIds": [], "impact": "nenhuma review útil para este critério"},
    {"criterion": "fantasy_nobility", "usedReviewIds": [], "impact": "..."},
    {"criterion": "action_adventure", "usedReviewIds": [], "impact": "..."},
    {"criterion": "adult_content", "usedReviewIds": [], "impact": "..."},
    {"criterion": "protagonist", "usedReviewIds": [], "impact": "..."},
    {"criterion": "humor", "usedReviewIds": [], "impact": "..."},
    {"criterion": "drama", "usedReviewIds": [], "impact": "..."},
    {"criterion": "tragedy", "usedReviewIds": [], "impact": "..."}
  ]
}`

function hasR19Marker(req: AiEvaluationRequest): boolean {
  const haystack = [
    req.synopsis ?? "",
    ...(req.tags ?? []),
  ].join("\n")
  return /\bR19\b/i.test(haystack)
}

function hasExternalReviews(req: AiEvaluationRequest): boolean {
  return Boolean(req.sourcedReviews?.length || req.reviews?.length)
}

function expectedReviewIds(req: AiEvaluationRequest): string[] {
  const count = req.sourcedReviews?.length || req.reviews?.length || 0
  return Array.from({ length: count }, (_, index) => `R${index + 1}`)
}

function buildUserPrompt(req: AiEvaluationRequest): string {
  const r19Detected = hasR19Marker(req)
  const reviewIds = expectedReviewIds(req)
  const lines: string[] = [
    `Título oficial da obra a avaliar: "${req.title}"`,
    "(use SOMENTE este título nas suas respostas)",
  ]

  if (req.synopsis?.trim()) {
    lines.push(`\nSinopse:\n${req.synopsis.trim()}`)
  } else {
    lines.push(`\nSinopse: (não fornecida — baseie-se em gêneros, tags e reviews compatíveis; mantenha confidence baixa)`)
  }

  if (req.genres?.length) {
    lines.push(`\nGêneros (todos os gêneros cadastrados): ${req.genres.join(", ")}`)
  }

  if (req.tags?.length) {
    lines.push(`Tags (todas as tags cadastradas): ${req.tags.join(", ")}`)
  }

  lines.push(
    `Marcador R19 detectado na sinopse/tags: ${r19Detected ? "SIM" : "NÃO"}`
  )
  if (r19Detected) {
    lines.push(
      `Para adult_content, aplique a regra obrigatória de R19: nota mínima 7.0 e justificativa mencionando R19.`
    )
  }

  if (req.sourcedReviews?.length) {
    lines.push(
      `\nReviews de usuários externas (buscadas por similaridade de título — VERIFIQUE se descrevem a mesma obra antes de usar):`
    )
    req.sourcedReviews.forEach((r, i) => {
      const matchPct = Math.round(r.matchScore * 100)
      lines.push(
        `[${reviewIds[i]}] (fonte: ${r.source}, match com o título: ${matchPct}%, título-fonte: "${r.sourceTitle}")\n${r.text}`
      )
    })
    lines.push(
      `\nLembrete: se uma review acima descrever uma obra DIFERENTE da sinopse fornecida, IGNORE-a completamente. Se não houver conflito claro, use a review como evidência auxiliar.`
    )
    lines.push(
      `Instrução obrigatória: para cada nota, considere essas reviews de usuários compatíveis junto com sinopse/tags/gêneros. Quando uma review influenciar a nota ou confirmar a evidência, mencione "review de usuário", "review externa" ou a fonte na justificativa, incluindo o ID da review, como "review R1". Preencha "review_usage" com os IDs usados.`
    )
  } else if (req.reviews?.length) {
    lines.push(
      `\nReviews de usuários externas:\n${req.reviews.map((review, index) => `[${reviewIds[index]}] ${review}`).join("\n")}`
    )
    lines.push(
      `Instrução obrigatória: para cada nota, considere essas reviews de usuários junto com sinopse/tags/gêneros. Quando uma review influenciar a nota ou confirmar a evidência, mencione "review de usuário" ou "review externa" na justificativa, incluindo o ID da review, como "review R1". Preencha "review_usage" com os IDs usados.`
    )
  } else {
    lines.push(
      `\nReviews de usuários externas: nenhuma review externa compatível foi encontrada.`
    )
  }

  lines.push(
    `\nAvalie a obra "${req.title}" com base nas rubricas do sistema. Use todos os gêneros e todas as tags fornecidas. Use reviews de usuários externas compatíveis como evidência auxiliar na avaliação e cite-as nas justificativas quando fizer sentido. Use apenas evidências presentes nos dados fornecidos; não invente eventos de plot. Retorne todos os 9 critérios. No "summary", refira-se à obra apenas como "${req.title}".`
  )
  return lines.join("\n")
}

function rawObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : { value }
}

function normalizeReviewId(value: unknown): string | null {
  const match = String(value).trim().toUpperCase().match(/R?\s*\[?(\d+)\]?/)
  if (!match) return null
  return `R${Number(match[1])}`
}

function extractUsedReviewIds(rawResponse: unknown): string[] {
  const raw = rawObject(rawResponse)
  const usage = raw.review_usage
  if (!Array.isArray(usage)) return []

  const ids = new Set<string>()
  for (const entry of usage) {
    if (typeof entry !== "object" || entry === null) continue
    const usedReviewIds = (entry as Record<string, unknown>).usedReviewIds
    if (!Array.isArray(usedReviewIds)) continue

    for (const id of usedReviewIds) {
      const normalized = normalizeReviewId(id)
      if (normalized) ids.add(normalized)
    }
  }

  return [...ids]
}

function enforceAuditableReviewUsage(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  const expectedIds = expectedReviewIds(req)
  if (expectedIds.length === 0) {
    return {
      ...response,
      rawResponse: {
        ...rawObject(response.rawResponse),
        reviewAudit: {
          required: false,
          passed: true,
          reason: "Nenhuma review externa foi encontrada para incluir no prompt.",
        },
      },
    }
  }

  const expected = new Set(expectedIds)
  const usedReviewIds = extractUsedReviewIds(response.rawResponse)
    .filter((id) => expected.has(id))
  const justifications = response.scores
    .map((score) => score.justification)
    .join(" ")

  const citedInJustification = usedReviewIds.some((id) => (
    new RegExp(`\\b${id}\\b`, "i").test(justifications)
  ))

  if (usedReviewIds.length === 0 || !citedInJustification) {
    throw new Error(
      `A IA recebeu ${expectedIds.length} review(s), mas não declarou uso auditável por ID em review_usage e nas justificativas. Avaliação rejeitada para evitar salvar nota sem evidência de uso de reviews.`
    )
  }

  return {
    ...response,
    rawResponse: {
      ...rawObject(response.rawResponse),
      reviewAudit: {
        required: true,
        passed: true,
        expectedReviewIds: expectedIds,
        usedReviewIds,
      },
    },
  }
}

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const source = fenced?.[1] ?? raw
  const start = source.indexOf("{")
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === "\"") {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === "{") depth += 1
    if (char === "}") depth -= 1

    if (depth === 0) {
      return source.slice(start, index + 1)
    }
  }

  return null
}

function parseClaudeResponse(raw: string, title: string): AiEvaluationResponse {
  const json = JSON.parse(raw)

  const scoreMap: Record<string, { score: number; justification: string }> = {}
  for (const s of json.scores ?? []) {
    if (s.criterion && s.score != null) {
      scoreMap[s.criterion] = {
        score: Math.max(0, Math.min(10, parseFloat(s.score))),
        justification: s.justification ?? "",
      }
    }
  }

  // Garante que todos os critérios estão presentes
  const scores = CRITERION_SLUGS.map((slug) => ({
    criterionSlug: slug,
    suggestedScore: scoreMap[slug]?.score ?? 5,
    justification: scoreMap[slug]?.justification ?? "Não avaliado.",
  }))

  return {
    modelName: MODEL,
    promptVersion: PROMPT_VERSION,
    summary: json.summary ?? `Avaliação de "${title}" concluída.`,
    confidence: Math.max(0, Math.min(1, parseFloat(json.confidence ?? "0.8"))),
    scores,
    rawResponse: json,
  }
}

function enforceR19AdultContentRule(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  if (!hasR19Marker(req)) return response

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "adult_content" || score.suggestedScore >= 7) {
        return score
      }

      return {
        ...score,
        suggestedScore: 7,
        justification: score.justification.includes("R19")
          ? score.justification
          : `${score.justification} Marcador R19 encontrado na sinopse/tags; pela regra obrigatória, adult_content não pode ficar abaixo de 7.0.`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      r19AdultContentRuleApplied: true,
    },
  }
}

function enforceNeutralCoupleDynamicsWhenNoRomance(
  response: AiEvaluationResponse
): AiEvaluationResponse {
  const romance = response.scores.find((score) => score.criterionSlug === "romance")
  const couple = response.scores.find((score) => score.criterionSlug === "couple_dynamics")

  if (!romance || !couple || romance.suggestedScore > 3 || couple.suggestedScore >= 5) {
    return response
  }

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "couple_dynamics") return score
      return {
        ...score,
        suggestedScore: 5,
        justification: score.justification.includes("critério não é aplicável")
          ? score.justification
          : `${score.justification} Como a avaliação de romance indica ausência/irrelevância de casal, couple_dynamics foi neutralizada em 5.0 para não penalizar uma obra sem romance/casal aplicável.`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      neutralCoupleDynamicsRuleApplied: true,
    },
  }
}

function attachEvaluationContext(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  return {
    ...response,
    rawResponse: {
      ...rawObject(response.rawResponse),
      evaluationContext: {
        genresCount: req.genres?.length ?? 0,
        tagsCount: req.tags?.length ?? 0,
        sourcedReviewsCount: req.sourcedReviews?.length ?? 0,
        legacyReviewsCount: req.reviews?.length ?? 0,
        reviewsIncludedInPrompt: hasExternalReviews(req),
        sourcedReviews: req.sourcedReviews?.map((review) => ({
          source: review.source,
          sourceTitle: review.sourceTitle,
          matchScore: review.matchScore,
          excerpt: review.text.slice(0, 500),
        })) ?? [],
        r19Detected: hasR19Marker(req),
      },
    },
  }
}

function postProcessEvaluation(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  return attachEvaluationContext(
    enforceAuditableReviewUsage(
      enforceNeutralCoupleDynamicsWhenNoRomance(
        enforceR19AdultContentRule(response, req)
      ),
      req
    ),
    req
  )
}

export async function requestAiEvaluation(
  req: AiEvaluationRequest
): Promise<AiEvaluationResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada. Avaliação IA real não foi executada.")
  }

  const client = new Anthropic({ apiKey })
  const basePrompt = buildUserPrompt(req)
  let lastRawText = ""
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: attempt === 0 ? 3500 : 4500,
      temperature: attempt === 0 ? 0.2 : 0,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nA tentativa anterior não retornou JSON válido/completo OU não passou na auditoria de uso de reviews. Se reviews foram fornecidas, use pelo menos uma review compatível, cite o ID dela nas justificativas como "review R1" e preencha "review_usage" com IDs válidos. Responda agora SOMENTE com o objeto JSON completo no formato solicitado, sem markdown e sem texto extra.`,
      }],
    })

    lastRawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")

    const jsonText = extractJsonObject(lastRawText)
    if (!jsonText) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta da IA foi cortada por limite de tokens."
          : "Resposta da IA não continha JSON válido."
      )
      continue
    }

    try {
      return postProcessEvaluation(parseClaudeResponse(jsonText, req.title), req)
    } catch (err) {
      lastError = err
    }
  }

  console.error("[AI] Erro ao interpretar resposta:", lastError, lastRawText)
  throw new Error("Erro ao interpretar resposta da IA. Nenhuma avaliação foi salva.")
}
