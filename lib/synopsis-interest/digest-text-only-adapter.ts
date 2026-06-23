/**
 * Plano 3 Fase B2.2Q-fix §8 — Adapter REAL (Anthropic) do digest `text-only-v1`. PREPARADO, NÃO
 * EXECUTADO nesta fase. O boundary oficial (`getAnthropicClient`/`createLoggedMessage`) é carregado
 * por IMPORT DINÂMICO dentro de `defaultSend()` ⇒ importar este módulo NÃO tem efeito colateral e
 * NÃO toca a rede. Nos testes, injeta-se `send` (cliente mockado) e o boundary real nunca é tocado.
 *
 * NÃO persiste em `works`. NÃO usa o executor de produção. NÃO chama LLM no import/build/teste.
 */

import {
  EXPERIMENT_DIGEST_PROMPT_VERSION,
  buildDigestModelRequest,
  extractDigestToolInput,
  type DigestModelAdapter,
  type DigestModelInput,
  type DigestModelOutput,
} from "@/lib/synopsis-interest/digest-text-only"

export interface AnthropicSendResult {
  message: { model?: string; content?: Array<{ type?: string; name?: string; input?: unknown }> }
  usage?: { inputTokens?: number; outputTokens?: number }
}
/** Boundary de envio: recebe os params Anthropic + meta de log, retorna a message + uso. */
export type AnthropicSend = (params: unknown, meta: unknown) => Promise<AnthropicSendResult>

export interface AnthropicDigestAdapterDeps {
  /** Injetar nos TESTES (cliente mockado). Default: boundary REAL via import dinâmico. */
  send?: AnthropicSend
  workId?: string
}

/**
 * Factory do adapter real. Com `deps.send` injetado, nunca alcança o boundary real (testes). Sem
 * ele, carrega o boundary por import dinâmico SÓ na 1ª chamada de `generate` (nunca no import).
 */
export function createAnthropicDigestAdapter(deps: AnthropicDigestAdapterDeps = {}): DigestModelAdapter {
  return {
    async generate(input: DigestModelInput): Promise<DigestModelOutput> {
      const params = buildDigestModelRequest(input)
      const meta = {
        operation: "review_digest",
        promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
        workId: deps.workId ?? null,
        metadata: { experiment: "text-only-v1" },
      }
      const send: AnthropicSend = deps.send ?? (await loadRealSend())
      const { message, usage } = await send(params, meta)
      const raw = extractDigestToolInput(message)
      if (raw == null) throw new Error("tool_use ausente na resposta do modelo (text-only digest)")
      return {
        raw,
        model: message.model ?? input.model,
        usage: usage ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } : undefined,
      }
    },
  }
}

/** Boundary REAL — import DINÂMICO (sem efeito colateral no import deste módulo). NÃO em testes. */
async function loadRealSend(): Promise<AnthropicSend> {
  const mod = (await import("@/lib/ai/anthropic-client")) as {
    getAnthropicClient: (o?: { maxRetries?: number }) => unknown
    createLoggedMessage: (client: unknown, params: unknown, meta: unknown) => Promise<{ message: AnthropicSendResult["message"]; usage: { inputTokens: number; outputTokens: number } }>
  }
  const client = mod.getAnthropicClient({ maxRetries: 3 })
  return async (params, meta) => {
    const r = await mod.createLoggedMessage(client, params, meta)
    return { message: r.message, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } }
  }
}
