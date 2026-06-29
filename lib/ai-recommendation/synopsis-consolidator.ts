import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"

export const CONSOLIDATOR_MODEL = "claude-haiku-4-5-20251001"
export const CONSOLIDATOR_PROMPT_VERSION = "v2"

const SYSTEM_PROMPT = `Você é um editor que consolida múltiplas sinopses de uma mesma obra (manhwa, anime, manga) em uma única sinopse canônica.

REGRAS:
- Saída: ~150-220 palavras em português brasileiro.
- Preserve os pontos centrais da trama, protagonista(s) e premissa que aparecem na maioria das versões.
- Espelhe o TOM e o REGISTRO das versões originais. Se elas são bem-humoradas, leves e animadas, a canônica deve soar assim (mantenha o humor e a energia). Se são sérias, sóbrias e descritivas, mantenha esse perfil. Deixe o tom dominante das fontes guiar a escrita — não achate tudo para um estilo neutro/genérico.
- O tom é uma questão de estilo, não de conteúdo: ao ajustar o registro, não invente fatos, piadas ou eventos que não estão nas versões.
- Remova redundância: se três versões dizem o mesmo, escreva uma vez.
- Não inclua spoilers profundos que só uma versão revela.
- Não cite as fontes (nada de "segundo a Tapas", "[Source]", etc.).
- Texto contínuo, sem listas, sem markdown, sem headers.
- Se as versões discordam em fatos centrais, prefira a versão mais detalhada/longa.
- Não invente — só consolide o que já está nas versões.
- Retorne APENAS a sinopse consolidada. Sem prefixo "Sinopse:", sem aspas envolvendo o texto.`

export interface ConsolidateSynopsisResult {
  canonical: string
  model: string
  promptVersion: string
  tokensIn: number
  tokensOut: number
}

/** Status detalhado para o caller decidir se interrompe lotes em falhas em série. */
export type ConsolidateSynopsisStatus =
  | { kind: "ok"; result: ConsolidateSynopsisResult }
  | { kind: "skipped"; reason: "no_content" | "no_api_key" }
  | { kind: "api_failed"; error: string }

/**
 * Tamanho mínimo (chars) de um bloco de sinopse pra valer consolidação — blocos
 * menores (1-2 palavras) são descartados. Exportado pra que a CONTAGEM de
 * pendência (`countPendingCanonicalSynopses`) use o MESMO gate da consolidação e
 * não conte obras que o consolidador sempre pula (badge "preso"). Ver
 * `hasConsolidatableBlocks`.
 */
export const SYNOPSIS_MIN_BLOCK_CHARS = 40

/** Há ≥1 bloco longo o bastante pra consolidar (mesmo gate de `consolidateSynopsisDetailed`). */
export function hasConsolidatableBlocks(blocks: string[]): boolean {
  return blocks.some((b) => b.trim().length >= SYNOPSIS_MIN_BLOCK_CHARS)
}

/**
 * Pega um array de blocos de sinopse (de fontes diferentes) e devolve uma
 * sinopse canônica consolidada via Haiku. Retorna `{ kind: "skipped" }` quando
 * não há conteúdo útil ou `{ kind: "api_failed" }` quando a Anthropic falha.
 *
 * Wrapper retro-compatível: `consolidateSynopsis()` segue retornando o result
 * ou null pros callers existentes.
 */
export interface ConsolidateSynopsisOptions {
  workId?: string | null
}

export async function consolidateSynopsis(
  blocks: string[],
  opts: ConsolidateSynopsisOptions = {},
): Promise<ConsolidateSynopsisResult | null> {
  const status = await consolidateSynopsisDetailed(blocks, opts)
  return status.kind === "ok" ? status.result : null
}

export async function consolidateSynopsisDetailed(
  blocks: string[],
  opts: ConsolidateSynopsisOptions = {},
): Promise<ConsolidateSynopsisStatus> {
  if (!process.env.ANTHROPIC_API_KEY) return { kind: "skipped", reason: "no_api_key" }

  const cleaned = blocks
    .map((b) => b.trim())
    .filter((b) => b.length >= SYNOPSIS_MIN_BLOCK_CHARS) // descarta blocos minúsculos (1-2 palavras)
  if (cleaned.length === 0) return { kind: "skipped", reason: "no_content" }
  // Sempre roda Haiku quando há conteúdo. Mesmo bloco único curto vale o custo
  // (~$0.002) porque traduz pra PT-BR e padroniza o estilo da sinopse.

  const numbered = cleaned
    .map((block, i) => `[V${i + 1}]\n${block}`)
    .join("\n\n---\n\n")

  const userPrompt = `Consolide as ${cleaned.length} versão(ões) abaixo em uma única sinopse canônica em PT-BR.\n\n${numbered}`

  try {
    // maxRetries baixo aqui (3) porque o caller do backfill em lote já tem
    // early-exit em falhas consecutivas. Esperar 90s por obra travaria a UI.
    const client = getAnthropicClient({ maxRetries: 3 })
    const { message } = await createLoggedMessage(
      client,
      {
        model: CONSOLIDATOR_MODEL,
        max_tokens: 800,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        operation: "synopsis_consolidator",
        promptVersion: CONSOLIDATOR_PROMPT_VERSION,
        workId: opts.workId ?? null,
        metadata: { nBlocks: cleaned.length },
      },
    )

    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    if (!text) return { kind: "skipped", reason: "no_content" }

    return {
      kind: "ok",
      result: {
        canonical: text,
        model: CONSOLIDATOR_MODEL,
        promptVersion: CONSOLIDATOR_PROMPT_VERSION,
        tokensIn: message.usage.input_tokens,
        tokensOut: message.usage.output_tokens,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[synopsis-consolidator] falhou:", msg)
    return { kind: "api_failed", error: msg }
  }
}

/**
 * Hash determinístico dos blocos (ordenados) — usado pra detectar se o input
 * mudou desde a última consolidação e evitar re-rodar.
 */
export function hashSynopsisInputs(blocks: string[]): string {
  const normalized = blocks
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .sort()
    .join("|")
  return createHash("sha256").update(normalized).digest("hex")
}
