import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"

export interface AiEvaluationRequest {
  workId: string
  title: string
  synopsis?: string | null
  genres?: string[]
  tags?: string[]
  reviews?: string[]
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
const PROMPT_VERSION = "v4"

const SYSTEM_PROMPT = `Você é um especialista em mangá, manhwa e manhua. Sua tarefa é avaliar títulos com base em critérios específicos.

Você receberá informações sobre um título (nome, sinopse, gêneros, tags e reviews externas, quando existirem) e deverá retornar notas numéricas para cada um dos 9 critérios de avaliação.

IMPORTANTE: Responda APENAS com um objeto JSON válido. Sem markdown, sem explicações fora do JSON.

Use somente os critérios e faixas abaixo. A nota deve refletir a faixa correspondente, não uma impressão geral.
Use decimais como 7.5 quando a obra estiver entre dois níveis. Se as informações forem insuficientes, use uma nota conservadora e explique a incerteza na justificativa.
Use reviews como evidência auxiliar para tom, dinâmica do casal, tragédia, drama, humor, ritmo, conteúdo adulto e impacto da obra. Não invente eventos que não estejam na sinopse/tags/reviews.

CRITÉRIOS E RUBRICAS:

1. romance
- 0-3: Ausente / irrelevante. Não tem romance ou é totalmente secundário. Pode haver crush leve que não impacta nada.
- 4-6: Subplot. Romance existe, mas não guia a história. Desenvolvimento lento ou pouco foco.
- 7-8: Core romance. Romance é um dos pilares da história e impacta decisões, conflitos e evolução.
- 9-10: Romance-driven. A história é sobre o romance; o plot gira em torno do relacionamento.

2. couple_dynamics
- 0-3: Dinâmica de obsessão, controle, toxicidade, abuso emocional, manipulação ou relação majoritariamente prejudicial.
- 4-6: Há mal-entendidos eventuais, ciúme e algum nível de conflito.
- 7-8: Relacionamento saudável, com alguns conflitos eventuais, mas trabalhados e resolvidos relativamente rápido.
- 9-10: Dinâmica leve, divertida e saudável; parceria, desenvolvimento mútuo e boa comunicação.

3. fantasy_nobility
- 0-3: Realista / residual. Mundo normal ou fantasia irrelevante; fantasia como estética, por exemplo “é príncipe”, mas isso não importa.
- 4-6: Presente. Elementos de fantasia/nobreza existem e influenciam algumas partes da história.
- 7-8: Estrutural. Sistema de magia, política nobre, aristocracia, reencarnação, nobreza ou fantasia afetam conflitos principais.
- 9-10: Dominante. O mundo é construído em cima disso; regras de fantasia/nobreza definem a história.

4. action_adventure
- 0-3: Principalmente slice of life. Ritmo mais parado, eventos cotidianos.
- 4-6: Ritmo um pouco mais agitado, mas sem grandes eventos ou desenrolar emocionante.
- 7-8: Presença constante de situações marcantes, ritmo acelerado, protagonistas envolvidos em eventos significativos para o mundo.
- 9-10: Raramente há momentos parados/cotidianos; protagonistas em missão para salvar/mudar o mundo/história ou centro de eventos extremamente marcantes.

5. adult_content
- 0-3: Clean. Sem sexualização relevante; no máximo beijo leve ou sugestão implícita.
- 4-6: Suggestive. Insinuação clara, roupas/situações/tensão sexual; pode ter cena cortada/fade to black.
- 7-8: Mature. Sexo parcialmente mostrado, sem foco explícito; nudez e contexto sexual relevante para a trama.
- 9-10: Smut. Sexo explícito recorrente; foco no ato, não só na narrativa.

6. protagonist
- 0-3: Fraco / genérico. Esquecível, sem personalidade clara; poderia ser trocado sem grande diferença.
- 4-6: Funcional. Tem personalidade básica e conduz a história, mas não brilha.
- 7-8: Forte. Presença clara, decisões relevantes, personalidade consistente; destaca-se por força, inteligência ou habilidade.
- 9-10: Icônico / overpowered. Carrega a obra; mesmo sem plot, o protagonista sustentaria o interesse.

7. humor
- 0-3: Ausente. Quase nenhum humor; tom sério o tempo todo.
- 4-6: Pontual. Piadas ocasionais; alívio cômico, não base do tom.
- 7-8: Presente. Humor aparece com frequência em diálogos ou estilo visual; parte importante do tom.
- 9-10: Dominante. Comédia frequente, piadas, sátiras ou bom humor marcante; até cenas sérias podem ter humor.

8. drama
- 0-3: Leve. Pouco conflito emocional; problemas simples, resolução rápida.
- 4-6: Moderado. Conflitos existem; emoção presente, mas controlada.
- 7-8: Intenso. Conflitos profundos e recorrentes; impactam decisões e ritmo da história.
- 9-10: Dominante. Emoção marcante durante toda a obra; alta carga emocional.

9. tragedy
- 0-3: Ausente. Nada muito trágico acontece.
- 4-6: Leve. Eventos tristes acontecem durante a história, mas são reversíveis, breves ou pouco impactantes.
- 7-8: Pesada. Mortes ou perdas importantes acontecem no meio da obra e impactam o desenvolvimento dos personagens principais, causando vários capítulos de ruptura/conflito.
- 9-10: Brutal. Sofrimento constante ou extremo; sensação forte de inevitabilidade ou injustiça.
- Regra obrigatória: considere tragédia apenas o que ocorre no meio do desenvolvimento da história, não apenas o cenário inicial/backstory. Abuso, abandono, traição, revenge setup ou sofrimento passado da protagonista não contam como tragédia ativa se são apenas contexto anterior ao core da obra. Backstory sozinho deve ficar em 0-3.
- Só use 4+ se a sinopse, gêneros, tags ou dados fornecidos mostrarem explicitamente eventos trágicos acontecendo durante a história. Não infira perdas no meio da obra a partir de uma premissa triste.
- Se a evidência for incerta, escolha 0-3 e explique que não há evidência clara de tragédia no desenvolvimento principal.

Na justificativa de cada critério, cite explicitamente qual faixa foi escolhida e por quê.

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

  if (req.reviews?.length) {
    lines.push(`\nReviews externas:\n${req.reviews.map((review, index) => `[${index + 1}] ${review}`).join("\n")}`)
  }

  lines.push("\nAvalie este título com base exatamente nas rubricas do sistema. Use apenas evidências presentes nos dados fornecidos; não invente eventos de plot. Retorne todos os 9 critérios.")
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
    max_tokens: 1600,
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
