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

export interface ChatToolCall {
  userContext: string
  n: number
}

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
    if (!content) continue
    out.push({ role: m.role, content })
  }
  return out
}

function findToolUse(message: Anthropic.Messages.Message, toolName: string) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === toolName,
  )
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
}): Promise<ChatTurnResult> {
  const apiMessages = toApiMessages(args.messages)
  if (apiMessages.length === 0) {
    throw new Error("Conversa vazia — nada pra enviar ao modelo.")
  }

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
      tools: [RECOMMEND_WORKS_TOOL],
      tool_choice: { type: "auto" },
      messages: apiMessages,
    },
    {
      operation: "recommendation_chat",
      promptVersion: CHAT_PROMPT_VERSION,
      metadata: { nTurns: apiMessages.length },
    },
  )

  const assistantText = extractText(message)
  const toolUse = findToolUse(message, RECOMMEND_WORKS_TOOL.name)
  let toolCall: ChatToolCall | null = null
  if (toolUse) {
    const input = (toolUse.input ?? {}) as { userContext?: unknown; n?: unknown }
    const userContext =
      typeof input.userContext === "string" ? input.userContext.trim() : ""
    if (userContext) {
      toolCall = { userContext, n: normalizeN(input.n) }
    }
  }

  return { assistantText, toolCall, usage, apiCallId }
}
