import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"

export interface AiEvaluationRequest {
  workId: string
  title: string
  synopsis?: string | null
  genres?: string[]
  tags?: string[]
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
const PROMPT_VERSION = "v2"

const SYSTEM_PROMPT = `Você é um especialista em mangá, manhwa e manhua. Sua tarefa é avaliar títulos com base em critérios específicos.

Você receberá informações sobre um título (nome, sinopse, gêneros, tags) e deverá retornar notas numéricas para cada um dos 9 critérios de avaliação.

IMPORTANTE: Responda APENAS com um objeto JSON válido. Sem markdown, sem explicações fora do JSON.

Escala de notas: 0 a 10 (use decimais como 7.5 quando apropriado)
- 0 = critério completamente ausente
- 5 = presença moderada
- 10 = presença dominante/extrema

CRITÉRIOS A AVALIAR:
1. romance — Nível de romance na história (enredo principal ou subplot forte)
2. couple_dynamics — Química, desenvolvimento e interações do casal principal
3. fantasy_nobility — Elementos de fantasia, nobreza, aristocracia, cenários medievais, reencarnação em famílias nobres
4. action_adventure — Cenas de ação, combates, lutas, jornadas de aventura
5. adult_content — Conteúdo explícito/maduro, sensualidade, temas sexuais
6. protagonist — Força, carisma, singularidade e memorabilidade do protagonista principal
7. humor — Presença e qualidade dos elementos cômicos
8. drama — Nível de tensão dramática, conflito emocional intenso (NÃO tragédia — apenas o drama das situações)
9. tragedy — Mortes de personagens importantes, perdas irreversíveis, finais devastadores

FORMATO DA RESPOSTA:
{
  "summary": "Avaliação geral em 2-3 frases em português",
  "confidence": 0.0 a 1.0,
  "scores": [
    {"criterion": "romance", "score": 0.0, "justification": "motivo breve em português"},
    {"criterion": "couple_dynamics", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "fantasy_nobility", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "action_adventure", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "adult_content", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "protagonist", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "humor", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "drama", "score": 0.0, "justification": "motivo breve"},
    {"criterion": "tragedy", "score": 0.0, "justification": "motivo breve"}
  ]
}`

function buildUserPrompt(req: AiEvaluationRequest): string {
  const lines: string[] = [`Título: ${req.title}`]

  if (req.synopsis?.trim()) {
    lines.push(`\nSinopse:\n${req.synopsis.trim()}`)
  }

  if (req.genres?.length) {
    lines.push(`\nGêneros: ${req.genres.join(", ")}`)
  }

  if (req.tags?.length) {
    lines.push(`Tags: ${req.tags.slice(0, 30).join(", ")}`)
  }

  lines.push("\nAvalie este título com base nos 9 critérios.")
  return lines.join("\n")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function requestAiEvaluation(
  req: AiEvaluationRequest
): Promise<AiEvaluationResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn("[AI] ANTHROPIC_API_KEY não configurada — usando mock")
    return generateMockEvaluation(req.title)
  }

  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(req) }],
  })

  const rawText = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")

  // Extrai o JSON mesmo que Claude adicione markdown
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error("[AI] Resposta inesperada do Claude:", rawText)
    return generateMockEvaluation(req.title)
  }

  try {
    return parseClaudeResponse(jsonMatch[0], req.title)
  } catch (err) {
    console.error("[AI] Erro ao parsear resposta:", err, rawText)
    return generateMockEvaluation(req.title)
  }
}

// ─── Fallback mock (usado quando a API key não está configurada) ────────────

function generateMockEvaluation(title: string): AiEvaluationResponse {
  const seed = hashString(title)
  const scores = CRITERION_SLUGS.map((slug, i) => {
    const base = 5 + ((seed >> (i * 3)) & 0x07) * 0.5 - 1.75
    return {
      criterionSlug: slug,
      suggestedScore: Math.max(1, Math.min(9, Math.round(base * 10) / 10)),
      justification: "Configure ANTHROPIC_API_KEY para avaliação real.",
    }
  })
  return {
    modelName: "mock-v1",
    promptVersion: "v1",
    summary:
      `Avaliação stub de "${title}". Configure ANTHROPIC_API_KEY no .env.local para ativar a IA real.`,
    confidence: 0.5,
    scores,
    rawResponse: { stub: true, title },
  }
}

function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0
  }
  return h
}
