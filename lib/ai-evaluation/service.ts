import "server-only"
import { createHash } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import type { SourcedReview } from "@/lib/external/types"

export interface AiEvaluationRequest {
  workId: string
  title: string
  synopsis?: string | null
  genres?: string[]
  tags?: string[]
  /** Backwards-compatible. Para chamadas novas, prefira sourcedReviews. */
  reviews?: string[]
  sourcedReviews?: SourcedReview[]
  externalContext?: string[]
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
const PROMPT_VERSION = "v8"
const MAX_REVIEW_CHARS = 500

// ============================================================================
// System prompt (estático — beneficia-se de prompt caching)
// ============================================================================

function buildCriteriaPromptSection(): string {
  return CRITERION_SLUGS.map((slug, index) => {
    const info = CRITERIA_INFO[slug]
    const rubric = CRITERIA_RUBRICS[slug]
    const description = info?.description?.trim()
      ? `\nDescrição do critério: ${info.description.trim()}`
      : ""
    const ranges = (rubric?.ranges ?? [])
      .map((range) => `- ${range}`)
      .join("\n")

    return `${index + 1}. ${slug} (${rubric?.title ?? info?.name ?? slug})${description}\n${ranges}`
  }).join("\n\n")
}

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

IMPORTANTE: Use SEMPRE a tool "submit_evaluation" para responder. Não escreva texto fora da tool.

CRITÉRIOS, DESCRIÇÕES E RUBRICAS (use a descrição para entender o que cada critério mede e use exatamente as faixas para pontuar):

${buildCriteriaPromptSection()}

REGRA OBRIGATÓRIA PARA COUPLE_DYNAMICS:
Se a obra não envolver romance/casal identificável, não atribua nota baixa por "ausência de casal". Use uma nota neutra 5.0 e explique que o critério não é aplicável por falta de romance/casal evidente. Só use 0-3 quando houver evidência explícita de uma dinâmica romântica/casal tóxica, abusiva, obsessiva ou manipuladora.

REGRA OBRIGATÓRIA PARA FANTASY_NOBILITY:
Obras ambientadas majoritariamente em corte, aristocracia, realeza, império, ducado, nobreza ou famílias nobres devem receber nota alta quando esse ambiente organiza a premissa e os conflitos. Se a obra combina nobreza/realeza com reencarnação, transmigração, isekai, regressão, segunda chance ou viagem no tempo, trate isso como evidência estrutural forte: em geral use 7-8, ou 9-10 se política nobre, magia, regras do mundo ou hierarquia social definirem a história. Não deixe em 4-6 quando a ambientação de nobreza/realeza for central.

REGRA OBRIGATÓRIA PARA ADULT_CONTENT:
Antes de pontuar adult_content, avalie normalmente sinopse, tags, gêneros e reviews compatíveis. Como evidência adicional, verifique se a sinopse ou as tags contêm exatamente o marcador "R19" (case-insensitive). Se "R19" aparecer na sinopse ou tags, trate como evidência explícita de conteúdo adulto/maduro: a nota de adult_content deve ser no mínimo 7.0. Use 9-10 se sinopse, tags ou reviews compatíveis indicarem smut/sexo explícito recorrente. A justificativa deve mencionar o marcador R19. Se R19 NÃO aparecer, pontue adult_content normalmente pelas demais evidências.

REGRA OBRIGATÓRIA PARA TRAGEDY (leia com atenção):
Considere tragédia SÓ o que ocorre NO MEIO/desenvolvimento da história, não o cenário inicial. Por exemplo: mesmo se a protagonista sofreu abuso na infância, foi abandonada, traída, largada e está buscando justiça — se a história em si se desenvolve DEPOIS que isso tudo aconteceu e esses fatos são apenas apresentados como CONTEXTO/BACKSTORY → nota baixa (0-3). Caso, no meio da história, o casal se depare com situações trágicas, se separem, fiquem vários capítulos em conflito/desarmonia, sofrendo → nota alta (7-10).
Não infira tragédia ativa a partir de premissas tristes ou tropes de revenge/segunda chance.`

// ============================================================================
// Structured output: tool definition + Zod payload schema
// ============================================================================

const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS] as string[]

const EVALUATION_TOOL = {
  name: "submit_evaluation",
  description:
    "Retorna a avaliação estruturada da obra. Use SEMPRE esta tool para responder; não escreva texto livre fora dela.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "Avaliação geral em 2-3 frases em português, citando o título fornecido apenas.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Confiança da avaliação (0 a 1). Baixa quando sinopse/reviews são insuficientes.",
      },
      scores: {
        type: "array",
        minItems: CRITERION_SLUGS.length,
        maxItems: CRITERION_SLUGS.length,
        items: {
          type: "object",
          properties: {
            criterion: { type: "string", enum: CRITERION_SLUG_ENUM },
            score: { type: "number", minimum: 0, maximum: 10 },
            justification: {
              type: "string",
              description:
                "Justificativa citando a faixa escolhida (ex.: 'Faixa 7-8 (Core Romance): ...') e os IDs das reviews usadas (ex.: 'review R1').",
            },
          },
          required: ["criterion", "score", "justification"],
        },
      },
      review_usage: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criterion: { type: "string", enum: CRITERION_SLUG_ENUM },
            usedReviewIds: {
              type: "array",
              items: { type: "string" },
              description:
                "Lista de IDs (ex.: ['R1','R3']) das reviews que sustentaram a nota deste critério. Vazia se nenhuma review ajudou.",
            },
            impact: {
              type: "string",
              description:
                "Como as reviews citadas alteraram ou confirmaram a nota. Vazio se usedReviewIds for vazio.",
            },
          },
          required: ["criterion", "usedReviewIds", "impact"],
        },
      },
    },
    required: ["summary", "confidence", "scores", "review_usage"],
  },
} satisfies Anthropic.Messages.Tool

const evaluationToolPayloadSchema = z.object({
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  scores: z.array(
    z.object({
      criterion: z.string(),
      score: z.number().min(0).max(10),
      justification: z.string(),
    })
  ),
  review_usage: z.array(
    z.object({
      criterion: z.string(),
      usedReviewIds: z.array(z.string()),
      impact: z.string(),
    })
  ),
})

type EvaluationToolPayload = z.infer<typeof evaluationToolPayloadSchema>

// ============================================================================
// Review preparation (dedup + sentence-aware truncation + stable IDs)
// ============================================================================

function reviewTextFingerprint(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4)
  )
}

function jaccardReviews(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = [...a].filter((w) => b.has(w)).length
  return intersection / new Set([...a, ...b]).size
}

function deduplicateReviews<T extends { text: string }>(reviews: T[]): T[] {
  const fingerprints: Array<Set<string>> = []
  const shortKeys = new Set<string>()
  return reviews.filter((r) => {
    const fp = reviewTextFingerprint(r.text)
    if (fp.size < 4) {
      const key = r.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
      if (shortKeys.has(key)) return false
      shortKeys.add(key)
      fingerprints.push(fp)
      return true
    }
    const isDup = fingerprints.some((existing) => jaccardReviews(fp, existing) >= 0.75)
    if (!isDup) {
      fingerprints.push(fp)
      return true
    }
    return false
  })
}

function truncateReviewText(text: string): string {
  if (text.length <= MAX_REVIEW_CHARS) return text
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let len = 0
  for (const sentence of sentences) {
    if (len + sentence.length + 1 > MAX_REVIEW_CHARS) break
    chunks.push(sentence)
    len += sentence.length + 1
  }
  if (chunks.length === 0) {
    return text.slice(0, MAX_REVIEW_CHARS) + "... [truncado]"
  }
  return `${chunks.join(" ")} [...]`
}

interface PreparedReviews {
  /** Reviews depois de dedup, na ordem em que aparecem no prompt. */
  sourcedReviews: SourcedReview[] | null
  legacyReviews: string[] | null
  /** R1, R2, … coerentes com a numeração efetivamente usada no prompt. */
  ids: string[]
}

function prepareReviews(req: AiEvaluationRequest): PreparedReviews {
  if (req.sourcedReviews?.length) {
    const deduped = deduplicateReviews(req.sourcedReviews)
    return {
      sourcedReviews: deduped,
      legacyReviews: null,
      ids: deduped.map((_, i) => `R${i + 1}`),
    }
  }
  if (req.reviews?.length) {
    const deduped = deduplicateReviews(req.reviews.map((text) => ({ text }))).map(
      (r) => r.text
    )
    return {
      sourcedReviews: null,
      legacyReviews: deduped,
      ids: deduped.map((_, i) => `R${i + 1}`),
    }
  }
  return { sourcedReviews: null, legacyReviews: null, ids: [] }
}

// ============================================================================
// R19 detection
// ============================================================================

function hasR19Marker(req: AiEvaluationRequest): boolean {
  const haystack = [
    req.synopsis ?? "",
    ...(req.genres ?? []),
    ...(req.tags ?? []),
    ...(req.externalContext ?? []),
    ...(req.sourcedReviews?.map((review) => review.text) ?? []),
    ...(req.reviews ?? []),
  ].join("\n")
  return /(?:^|[^a-z0-9])R\s*-?\s*19(?:[^a-z0-9]|$)/i.test(haystack)
}

// ============================================================================
// User prompt
// ============================================================================

function buildUserPrompt(req: AiEvaluationRequest, prepared: PreparedReviews): string {
  const r19Detected = hasR19Marker(req)
  const lines: string[] = [
    `Título oficial da obra a avaliar: "${req.title}"`,
    "(use SOMENTE este título nas suas respostas)",
  ]

  if (req.synopsis?.trim()) {
    lines.push(`\nSinopse:\n${req.synopsis.trim()}`)
  } else {
    lines.push(
      `\nSinopse: (não fornecida — baseie-se em gêneros, tags e reviews compatíveis; mantenha confidence baixa)`
    )
  }

  if (req.genres?.length) {
    lines.push(`\nGêneros (todos os gêneros cadastrados): ${req.genres.join(", ")}`)
  }

  if (req.tags?.length) {
    lines.push(`Tags (todas as tags cadastradas): ${req.tags.join(", ")}`)
  }

  if (req.externalContext?.length) {
    lines.push(
      `\nContexto externo aceito para complementar a avaliação (sinopses/metadados de fontes com título compatível):`
    )
    req.externalContext.forEach((context, index) => {
      lines.push(`[C${index + 1}] ${context}`)
    })
  }

  lines.push(
    `Marcador R19 detectado no conjunto de evidências (sinopse, gêneros, tags, contexto externo e reviews): ${r19Detected ? "SIM" : "NÃO"}`
  )
  if (r19Detected) {
    lines.push(
      `Para adult_content, aplique a regra obrigatória de R19: nota mínima 7.0 e justificativa mencionando R19.`
    )
  }

  if (prepared.sourcedReviews?.length) {
    lines.push(
      `\nReviews de usuários externas (buscadas por similaridade de título — VERIFIQUE se descrevem a mesma obra antes de usar):`
    )
    prepared.sourcedReviews.forEach((r, i) => {
      const matchPct = Math.round(r.matchScore * 100)
      lines.push(
        `[${prepared.ids[i]}] (fonte: ${r.source}, match com o título: ${matchPct}%, título-fonte: "${r.sourceTitle}")\n${truncateReviewText(r.text)}`
      )
    })
    lines.push(
      `\nLembrete: se uma review acima descrever uma obra DIFERENTE da sinopse fornecida, IGNORE-a completamente. Se não houver conflito claro, use a review como evidência auxiliar.`
    )
    lines.push(
      `Instrução obrigatória: para cada nota, considere essas reviews de usuários compatíveis junto com sinopse/tags/gêneros. Quando uma review influenciar a nota ou confirmar a evidência, mencione "review de usuário", "review externa" ou a fonte na justificativa, incluindo o ID da review, como "review R1". Preencha "review_usage" com os IDs usados.`
    )
  } else if (prepared.legacyReviews?.length) {
    lines.push(
      `\nReviews de usuários externas:\n${prepared.legacyReviews
        .map((review, index) => `[${prepared.ids[index]}] ${truncateReviewText(review)}`)
        .join("\n")}`
    )
    lines.push(
      `Instrução obrigatória: para cada nota, considere essas reviews de usuários junto com sinopse/tags/gêneros. Quando uma review influenciar a nota ou confirmar a evidência, mencione "review de usuário" ou "review externa" na justificativa, incluindo o ID da review, como "review R1". Preencha "review_usage" com os IDs usados.`
    )
  } else {
    lines.push(`\nReviews de usuários externas: nenhuma review externa compatível foi encontrada.`)
  }

  lines.push(
    `\nAvalie a obra "${req.title}" com base nas rubricas do sistema. Use todos os gêneros e todas as tags fornecidas. Use reviews de usuários externas compatíveis como evidência auxiliar na avaliação e cite-as nas justificativas quando fizer sentido. Use apenas evidências presentes nos dados fornecidos; não invente eventos de plot. Retorne todos os 9 critérios pela tool "submit_evaluation". No "summary", refira-se à obra apenas como "${req.title}".`
  )
  return lines.join("\n")
}

// ============================================================================
// Response post-processing
// ============================================================================

function rawObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
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

function buildResponseFromToolPayload(
  payload: EvaluationToolPayload,
  title: string
): AiEvaluationResponse {
  const scoreMap: Record<string, { score: number; justification: string }> = {}
  for (const s of payload.scores) {
    scoreMap[s.criterion] = {
      score: Math.max(0, Math.min(10, s.score)),
      justification: s.justification ?? "",
    }
  }

  const scores = CRITERION_SLUGS.map((slug) => ({
    criterionSlug: slug,
    suggestedScore: scoreMap[slug]?.score ?? 5,
    justification: scoreMap[slug]?.justification ?? "Não avaliado.",
  }))

  return {
    modelName: MODEL,
    promptVersion: PROMPT_VERSION,
    summary: payload.summary || `Avaliação de "${title}" concluída.`,
    confidence: Math.max(0, Math.min(1, payload.confidence)),
    scores,
    rawResponse: payload,
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

function enforceAuditableReviewUsage(
  response: AiEvaluationResponse,
  prepared: PreparedReviews
): AiEvaluationResponse {
  if (prepared.ids.length === 0) {
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

  const expected = new Set(prepared.ids)
  const usedReviewIds = extractUsedReviewIds(response.rawResponse).filter((id) =>
    expected.has(id)
  )
  const justifications = response.scores.map((s) => s.justification).join(" ")
  const citedInJustification = usedReviewIds.some((id) =>
    new RegExp(`\\b${id}\\b`, "i").test(justifications)
  )

  if (usedReviewIds.length > 0 && !citedInJustification) {
    throw new Error(
      `A IA declarou uso de reviews em review_usage (${usedReviewIds.join(", ")}) mas não as citou nas justificativas. Inconsistência rejeitada.`
    )
  }

  return {
    ...response,
    rawResponse: {
      ...rawObject(response.rawResponse),
      reviewAudit: {
        required: true,
        passed: true,
        expectedReviewIds: prepared.ids,
        usedReviewIds,
        reviewsDeclinedByModel: usedReviewIds.length === 0,
      },
    },
  }
}

function attachEvaluationContext(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest,
  prepared: PreparedReviews
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
        sourcedReviewsAfterDedup: prepared.sourcedReviews?.length ?? 0,
        legacyReviewsAfterDedup: prepared.legacyReviews?.length ?? 0,
        externalContextCount: req.externalContext?.length ?? 0,
        reviewsIncludedInPrompt: prepared.ids.length > 0,
        externalContext: req.externalContext?.map((context) => context.slice(0, 500)) ?? [],
        sourcedReviews:
          prepared.sourcedReviews?.map((review) => ({
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
  req: AiEvaluationRequest,
  prepared: PreparedReviews
): AiEvaluationResponse {
  return attachEvaluationContext(
    enforceAuditableReviewUsage(
      enforceNeutralCoupleDynamicsWhenNoRomance(enforceR19AdultContentRule(response, req)),
      prepared
    ),
    req,
    prepared
  )
}

// ============================================================================
// In-memory hash cache (Sprint 1; persistir em ai_evaluations fica para Sprint 2)
// ============================================================================

const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

interface CacheEntry {
  response: AiEvaluationResponse
  expiresAt: number
}

const evaluationCache = new Map<string, CacheEntry>()

function canonicalInputHash(req: AiEvaluationRequest): string {
  const canonical = {
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    title: req.title,
    synopsis: req.synopsis ?? "",
    genres: [...(req.genres ?? [])].sort(),
    tags: [...(req.tags ?? [])].sort(),
    externalContext: req.externalContext ?? [],
    sourcedReviews:
      req.sourcedReviews?.map((r) => ({
        source: r.source,
        sourceTitle: r.sourceTitle,
        matchScore: Math.round(r.matchScore * 1000) / 1000,
        text: r.text,
      })) ?? [],
    reviews: req.reviews ?? [],
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

function readCache(hash: string): AiEvaluationResponse | null {
  const entry = evaluationCache.get(hash)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    evaluationCache.delete(hash)
    return null
  }
  evaluationCache.delete(hash)
  evaluationCache.set(hash, entry)
  return entry.response
}

function writeCache(hash: string, response: AiEvaluationResponse) {
  evaluationCache.set(hash, { response, expiresAt: Date.now() + CACHE_TTL_MS })
  while (evaluationCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = evaluationCache.keys().next().value
    if (oldestKey === undefined) break
    evaluationCache.delete(oldestKey)
  }
}

// ============================================================================
// Public entry point
// ============================================================================

export async function requestAiEvaluation(
  req: AiEvaluationRequest
): Promise<AiEvaluationResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada. Avaliação IA real não foi executada.")
  }

  const cacheKey = canonicalInputHash(req)
  const cached = readCache(cacheKey)
  if (cached) {
    console.info(`[AI] Cache hit para "${req.title}" (hash=${cacheKey.slice(0, 8)})`)
    return cached
  }

  const prepared = prepareReviews(req)
  const client = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(req, prepared)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: attempt === 0 ? 3500 : 4500,
      temperature: attempt === 0 ? 0.2 : 0,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [EVALUATION_TOOL],
      tool_choice: { type: "tool", name: EVALUATION_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            attempt === 0
              ? userPrompt
              : `${userPrompt}\n\nA tentativa anterior não passou na auditoria de uso de reviews ou retornou payload inválido. Se reviews foram fornecidas, use pelo menos uma review compatível, cite o ID dela nas justificativas como "review R1" e preencha "review_usage" com IDs válidos. Use SEMPRE a tool "submit_evaluation".`,
        },
      ],
    })

    const toolUseBlock = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use"
    )

    if (!toolUseBlock) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta da IA foi cortada por limite de tokens."
          : "Resposta da IA não usou a tool submit_evaluation."
      )
      continue
    }

    const parsed = evaluationToolPayloadSchema.safeParse(toolUseBlock.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload da tool não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      )
      continue
    }

    try {
      const built = buildResponseFromToolPayload(parsed.data, req.title)
      const final = postProcessEvaluation(built, req, prepared)
      writeCache(cacheKey, final)
      return final
    } catch (err) {
      lastError = err
    }
  }

  console.error("[AI] Erro ao interpretar resposta:", lastError)
  throw new Error("Erro ao interpretar resposta da IA. Nenhuma avaliação foi salva.")
}
