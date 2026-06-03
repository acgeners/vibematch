import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { CHAT_SYSTEM_PROMPT, buildChatProfileBlock } from "./chat-prompt"
import { MODEL } from "./service"
import type { TokenUsage } from "./service"
import type { ChatMessage, TasteProfilePayload } from "./types"

export const CHAT_MODEL = MODEL
export const CHAT_PROMPT_VERSION = "chat-v1"

export const ALLOWED_CHAT_N = [10, 20, 30] as const
const DEFAULT_CHAT_N = 20

const RECOMMEND_WORKS_TOOL: Anthropic.Messages.Tool = {
  name: "recommend_works",
  description:
    "Dispara o motor de recomendação sobre o catálogo de descoberta do usuário. Use quando o mood/intenção já estiver claro o suficiente. Não liste obras você mesmo — o motor escolhe.",
  input_schema: {
    type: "object",
    properties: {
      userContext: {
        type: "string",
        description:
          "Resumo curto em PT-BR de TODO o mood acumulado da conversa, auto-contido (tom, gênero, exclusões, tamanho). Ex.: 'Algo leve, romance slow-burn, sem tragédia, curto pra terminar rápido.'",
      },
      n: {
        type: "integer",
        enum: [...ALLOWED_CHAT_N],
        description: "Quantas obras rankear. 20 padrão; 10 pra algo enxuto; 30 pra explorar mais.",
      },
    },
    required: ["userContext"],
  },
}

const EVALUATE_WORK_TOOL: Anthropic.Messages.Tool = {
  name: "evaluate_work",
  description:
    "Avalia UMA obra específica que o usuário nomeou. ANTES de chamar, pergunte como ele quer a avaliação: 'fit' (o quanto combina com o gosto dele — rápido/barato) ou 'full' (avaliação completa de 9 critérios — mais lenta e custosa). Só chame depois que o usuário escolher.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Título da obra exatamente como o usuário escreveu (ou a forma que ele confirmou na desambiguação).",
      },
      kind: {
        type: "string",
        enum: ["fit", "full"],
        description: "'fit' = alinhamento com o gosto do usuário (ranker). 'full' = avaliação completa de 9 critérios (pipeline Nota.IA).",
      },
      evenWithoutReviews: {
        type: "boolean",
        description: "Só para kind='full': passe true quando, num turno anterior, você avisou que não há reviews externas e o usuário confirmou que quer avaliar mesmo assim.",
      },
    },
    required: ["title", "kind"],
  },
}

const RECOMMEND_AMONG_TOOL: Anthropic.Messages.Tool = {
  name: "recommend_among",
  description:
    "Ranqueia/recomenda APENAS entre as obras que o usuário indicou explicitamente (uma lista de títulos). Use quando ele der 2+ títulos e quiser saber qual combina mais com ele.",
  input_schema: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        description: "Os títulos indicados pelo usuário, como ele os escreveu (mín. 2).",
      },
      userContext: {
        type: "string",
        description: "Mood/critério opcional pra orientar a comparação (ex.: 'pra hoje, algo leve'). Pode omitir.",
      },
    },
    required: ["titles"],
  },
}

export interface RecommendWorksCall {
  tool: "recommend_works"
  userContext: string
  n: number
}
export interface EvaluateWorkCall {
  tool: "evaluate_work"
  title: string
  kind: "fit" | "full"
  evenWithoutReviews: boolean
}
export interface RecommendAmongCall {
  tool: "recommend_among"
  titles: string[]
  userContext: string | null
}
export type ChatToolCall = RecommendWorksCall | EvaluateWorkCall | RecommendAmongCall

/**
 * Como o motor de recomendação pode ser acionado neste turno:
 * - "auto": o modelo decide (perguntar vs. recomendar) — comportamento padrão.
 * - "block": tools desligadas; o modelo é obrigado a só conversar/perguntar.
 *   Usado como trava de interatividade nos primeiros turnos.
 * - "force": força a chamada de `recommend_works` — usado pelo botão
 *   "Pode recomendar agora", que pula o briefing a pedido do usuário.
 */
export type ChatToolMode = "auto" | "block" | "force"

export interface ChatTurnResult {
  assistantText: string
  toolCall: ChatToolCall | null
  usage: TokenUsage
  apiCallId: string | null
}

/** Converte o histórico persistido em mensagens da API (texto puro, sem blocos
 * tool_use — evita o requisito de tool_result pareado ao re-enviar o histórico).
 * Turnos de assistente que recomendaram ganham um marcador textual pro modelo
 * lembrar o que já indicou. */
function toApiMessages(messages: ChatMessage[]): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = []
  for (const m of messages) {
    let content = m.content?.trim() ?? ""
    if (m.role === "assistant" && m.recommendation) {
      const rec = m.recommendation
      const titles = rec.items.slice(0, 8).map((i) => i.title).join(", ")
      const marker = `[recomendou ${rec.items.length} obra(s)${rec.userContext ? ` (contexto: "${rec.userContext}")` : ""}${titles ? `: ${titles}` : ""}]`
      content = content ? `${content}\n\n${marker}` : marker
    }
    if (m.role === "assistant" && m.evaluation) {
      const marker = `[avaliou "${m.evaluation.title}" nos 9 critérios]`
      content = content ? `${content}\n\n${marker}` : marker
    }
    if (!content) continue
    out.push({ role: m.role, content })
  }
  // A Anthropic Messages API exige que o array comece com role "user". O opener
  // proativo é persistido como messages[0] (assistant), só pra exibição — descarta
  // qualquer turno assistant inicial antes de enviar ao modelo.
  while (out.length > 0 && out[0].role === "assistant") out.shift()
  return out
}

function firstToolUse(message: Anthropic.Messages.Message) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
  )
}

function parseToolCall(message: Anthropic.Messages.Message): ChatToolCall | null {
  const block = firstToolUse(message)
  if (!block) return null
  const input = (block.input ?? {}) as Record<string, unknown>

  if (block.name === "recommend_works") {
    const userContext = typeof input.userContext === "string" ? input.userContext.trim() : ""
    if (!userContext) return null
    return { tool: "recommend_works", userContext, n: normalizeN(input.n) }
  }
  if (block.name === "evaluate_work") {
    const title = typeof input.title === "string" ? input.title.trim() : ""
    if (!title) return null
    const kind: "fit" | "full" = input.kind === "full" ? "full" : "fit"
    return { tool: "evaluate_work", title, kind, evenWithoutReviews: input.evenWithoutReviews === true }
  }
  if (block.name === "recommend_among") {
    const titles = Array.isArray(input.titles)
      ? input.titles
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : []
    if (titles.length === 0) return null
    const userContext =
      typeof input.userContext === "string" && input.userContext.trim()
        ? input.userContext.trim()
        : null
    return { tool: "recommend_among", titles, userContext }
  }
  return null
}

function extractText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
}

function normalizeN(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : Number.NaN
  return (ALLOWED_CHAT_N as readonly number[]).includes(n) ? n : DEFAULT_CHAT_N
}

/**
 * Roda um turno do chat. O modelo pode responder texto, chamar `recommend_works`,
 * ou ambos no mesmo turno (tool_choice: auto). Não força a tool — quem decide
 * recomendar vs. perguntar é o modelo, guiado pelo system prompt.
 */
export async function runChatTurn(args: {
  profile: TasteProfilePayload
  messages: ChatMessage[]
  /** Controla se/como o motor pode ser acionado neste turno. Default "auto". */
  toolMode?: ChatToolMode
}): Promise<ChatTurnResult> {
  const apiMessages = toApiMessages(args.messages)
  if (apiMessages.length === 0) {
    throw new Error("Conversa vazia — nada pra enviar ao modelo.")
  }

  const toolMode: ChatToolMode = args.toolMode ?? "auto"
  // Tools de alvo explícito (avaliar 1 obra / comparar uma lista) são pedidos
  // diretos do usuário e ficam SEMPRE disponíveis — inclusive no "block", que só
  // segura o `recommend_works` (a recomendação ampla, que precisa de briefing).
  // "force" obriga o `recommend_works` (botão "Pode recomendar agora").
  const TARGETED_TOOLS = [EVALUATE_WORK_TOOL, RECOMMEND_AMONG_TOOL]
  const tools =
    toolMode === "force"
      ? [RECOMMEND_WORKS_TOOL]
      : toolMode === "block"
        ? TARGETED_TOOLS
        : [RECOMMEND_WORKS_TOOL, ...TARGETED_TOOLS]
  const tool_choice: Anthropic.Messages.ToolChoice =
    toolMode === "force" ? { type: "tool", name: RECOMMEND_WORKS_TOOL.name } : { type: "auto" }

  const client = getAnthropicClient({ maxRetries: 6 })
  const { message, apiCallId, usage } = await createLoggedMessage(
    client,
    {
      model: CHAT_MODEL,
      max_tokens: 1500,
      temperature: 0.4,
      system: [
        { type: "text", text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: buildChatProfileBlock(args.profile), cache_control: { type: "ephemeral" } },
      ],
      ...(tools ? { tools } : {}),
      ...(tool_choice ? { tool_choice } : {}),
      messages: apiMessages,
    },
    {
      operation: "recommendation_chat",
      promptVersion: CHAT_PROMPT_VERSION,
      metadata: { nTurns: apiMessages.length },
    },
  )

  const assistantText = extractText(message)
  const toolCall = parseToolCall(message)

  return { assistantText, toolCall, usage, apiCallId }
}
