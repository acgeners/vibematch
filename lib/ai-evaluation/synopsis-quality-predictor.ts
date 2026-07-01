import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { getAnthropicClient, createLoggedMessage } from "@/lib/ai/anthropic-client"
import { formatTagsByGroup, truncate } from "@/lib/ai-recommendation/prompts"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
import type { UsageTokens } from "@/lib/ai/pricing"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"
import { BASE_INTEREST_PROMPT_VERSION } from "./compiled-preferences"
import type { CompiledPreferences } from "./compiled-preferences"

export const MODEL = "claude-sonnet-4-6"
// v3 (Frente 3): contrato e1 — quando há digest de reviews, o system ganha o
// adendo neutro e o user recebe o bloco CONTEXTO DE LEITORES. Sinopse segue
// dominante. Bump invalida as previsões v2 (re-prevê com digest sob demanda).
export const PROMPT_VERSION = BASE_INTEREST_PROMPT_VERSION

/**
 * Adendo de system PRÉ-COMPROMETIDO (contrato e1, validado na golden-3): instrui
 * a usar o digest como sinal COMPLEMENTAR, mantendo a SINOPSE dominante. Só entra
 * quando a obra tem digest — sem digest, o prompt é idêntico ao b1 (v2).
 */
export const E1_SYSTEM_ADDENDUM =
  "Além da sinopse, você recebe um RESUMO AGREGADO DE REVIEWS de leitores (consenso, divergências, traços recorrentes e avisos). Use-o como sinal COMPLEMENTAR ao julgamento — a SINOPSE segue dominante. Se não houver contexto de leitores, ignore esta parte."

/** Sinopse é o sinal principal — folga maior que os 600 chars do ranking. */
const SYNOPSIS_MAX_CHARS = 900

export const SYNOPSIS_QUALITY_SYSTEM_PROMPT = `Você estima o "Interesse Sinopse" de um usuário: quanto ele se interessaria por uma obra APENAS lendo a sinopse, com base no PERFIL DE GOSTO dele.

ENTRADA:
- PERFIL DE GOSTO (cacheado): loved_tags / avoided_tags (com strength 0–1), loved_themes / avoided_themes, narrative_patterns, criterion_preferences e summary. É a lente do julgamento.
- Por obra: título, tags da obra (contexto estruturado) e a SINOPSE (sinal principal — é o que o usuário "leria").

SAÍDA (4 faixas, sempre via tool \`submit_synopsis_quality\`):
- ♥ (Fraca): a sinopse não combina / cai em avoided_tags/avoided_themes / fora do gosto. Pouca ou nenhuma vontade.
- ♥♥ (Regular): alinhamento PARCIAL ou sinais mistos/fracos. Alguns elementos batem, mas o conjunto não convence. É a faixa do "interesse morno" — NÃO promova pra ♥♥♥ só por 1–2 tags em comum.
- ♥♥♥ (Boa): alinhamento CLARO e consistente com o perfil (vários loved_tags/temas convergindo), sem ressalvas fortes. Provavelmente testaria. Esta é a faixa PADRÃO de uma obra que combina — a maioria das obras alinhadas para AQUI.
- ♥♥♥♥ (Ótima): RESERVADA. Só com alinhamento excepcional e inquestionável: loved_tags fortes (strength alto) + loved_themes + narrative_patterns convergindo, sem nenhum avoided relevante. A obra "feita sob medida" pra ele. Deve ser minoria.

CALIBRAÇÃO (importante — a tendência natural é superestimar; corrija pra baixo):
- Seja CONSERVADOR, sobretudo no topo. "Combina bem" = ♥♥♥, não ♥♥♥♥.
- Na dúvida entre duas faixas, escolha SEMPRE a menor. Em especial, hesitou entre ♥♥♥ e ♥♥♥♥ → fique em ♥♥♥.
- ♥♥♥♥ exige evidência de MÚLTIPLAS fontes do perfil ao mesmo tempo (tags + temas + padrão narrativo). Um único sinal forte não basta — isso é ♥♥♥.
- Alinhamento parcial/temático mas sem o pacote completo = ♥♥, não ♥♥♥.

REGRAS:
1. A SINOPSE é o sinal dominante. As tags da obra ajudam a casar com loved/avoided_tags, mas julgue o interesse pela promessa narrativa da sinopse.
2. Presença de avoided_tags/avoided_themes puxa a faixa pra baixo, mesmo com outros pontos positivos.
3. Sem evidência clara de alinhamento nem de rejeição, fique em ♥♥ — não infle.
4. \`justification\`: 1–2 frases em PT-BR citando NOMES de tags/temas específicos do perfil que sustentam a faixa.
5. \`confidence\` (0–1): quanto você confia, dado o tamanho/clareza da sinopse e a força do match. Sinopse curta ou genérica ⇒ confiança baixa.
6. Sempre use a tool. Não retorne texto livre.`

export const SYNOPSIS_QUALITY_TOOL: Anthropic.Messages.Tool = {
  name: "submit_synopsis_quality",
  description: "Registra a estimativa de Interesse Sinopse (faixa de ♥) pra a obra avaliada.",
  input_schema: {
    type: "object",
    properties: {
      predicted_quality: {
        type: "string",
        enum: [...SYNOPSIS_QUALITIES],
        description: "Faixa estimada: ♥ (Fraca) / ♥♥ (Regular) / ♥♥♥ (Boa) / ♥♥♥♥ (Ótima).",
      },
      justification: {
        type: "string",
        description: "1–2 frases em PT-BR citando tags/temas do perfil que sustentam a faixa.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confiança 0–1 na estimativa.",
      },
    },
    required: ["predicted_quality", "justification"],
  },
}

export const synopsisQualityToolPayloadSchema = z.object({
  predicted_quality: z.enum([...SYNOPSIS_QUALITIES] as [SynopsisQuality, ...SynopsisQuality[]]),
  justification: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
})

export type SynopsisQualityToolPayload = z.infer<typeof synopsisQualityToolPayloadSchema>

function findToolUse(message: Anthropic.Messages.Message, toolName: string) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === toolName,
  )
}

export function buildSynopsisQualityUserPrompt(
  profile: TasteProfilePayload,
  work: PredictWorkInput,
  compiledPreferences?: CompiledPreferences | null,
): { profileBlock: string; tailBlock: string; digestBlock: string | null } {
  // Peça 2: com preferências compiladas ativas, o bloco v3.3 é ANEXADO aqui dentro
  // do bloco do PERFIL, que é cacheado (ephemeral). Como perfil + bloco são
  // constantes por lote, o cache do prompt segue quente (mesma economia ~3×).
  let profileBlock = `PERFIL DE GOSTO (cacheado, base da avaliação):
${JSON.stringify(profile, null, 2)}`
  if (compiledPreferences) {
    profileBlock += `\n\n${compiledPreferences.compiledBlock}`
  }

  const tailLines: string[] = [
    `OBRA A AVALIAR: work_id=${work.id} — "${work.title}"`,
    `tags: ${formatTagsByGroup(work.tags)}`,
    `sinopse: ${truncate(work.synopsis, SYNOPSIS_MAX_CHARS)}`,
    "",
    `Estime o Interesse Sinopse via tool \`submit_synopsis_quality\`.`,
  ]

  // Contrato e1: bloco CONTEXTO DE LEITORES com o digest já sanitizado. Vazio ⇒ null.
  const digest = work.reviewDigest?.trim()
  const digestBlock = digest
    ? `CONTEXTO DE LEITORES (resumo agregado de reviews):\n${digest}`
    : null

  return { profileBlock, tailBlock: tailLines.join("\n"), digestBlock }
}

export interface PredictWorkInput {
  id: string
  title: string
  synopsis: string | null
  tags: Array<{ name: string; group: string | null }>
  /**
   * Digest de reviews JÁ SANITIZADO/FORMATADO (texto) — contrato e1. null/ausente
   * ⇒ comportamento b1 (só sinopse). A sanitização/format acontece no wiring
   * (formatDigestForPrompt), não aqui.
   */
  reviewDigest?: string | null
}

export interface SynopsisQualityPrediction {
  predictedQuality: SynopsisQuality
  justification: string
  confidence: number | null
  modelName: string
  promptVersion: string
  usage: UsageTokens
  apiCallId: string | null
}

export interface PredictSynopsisQualityArgs {
  profile: TasteProfilePayload
  work: PredictWorkInput
  /** Reutiliza um client já criado no lote pra manter o cache do perfil quente. */
  client?: Anthropic
  /**
   * Preferências compiladas (Peça 2). null/ausente ⇒ prompt v3 sem injeção
   * (comportamento atual). Presente ⇒ bloco no perfil cacheado + addendum no
   * system, e a previsão é carimbada com `compiledPreferences.promptVersion` (v4).
   */
  compiledPreferences?: CompiledPreferences | null
}

/**
 * Estima o Interesse Sinopse de UMA obra. O bloco do perfil é marcado como
 * cacheable (ephemeral) — em lotes sequenciais as chamadas 2..N reaproveitam o
 * cache, derrubando o custo por obra (~3×). Faz até 2 tentativas.
 */
export async function predictSynopsisQuality(
  args: PredictSynopsisQualityArgs,
): Promise<SynopsisQualityPrediction> {
  if (!args.work.synopsis || args.work.synopsis.trim().length === 0) {
    throw new Error("Obra sem sinopse canônica — nada pra avaliar.")
  }

  const client = args.client ?? getAnthropicClient({ maxRetries: 6 })
  const compiled = args.compiledPreferences ?? null
  const promptVersion = compiled?.promptVersion ?? PROMPT_VERSION
  const { profileBlock, tailBlock, digestBlock } = buildSynopsisQualityUserPrompt(args.profile, args.work, compiled)

  // Contrato e1: com digest, o system ganha o adendo neutro (2º bloco, NÃO cacheado
  // pra não invalidar o cache do prompt-base) e o user recebe o bloco de leitores.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: SYNOPSIS_QUALITY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ]
  if (digestBlock) system.push({ type: "text", text: E1_SYSTEM_ADDENDUM })
  // Peça 2: addendum de preferências como bloco de system NÃO cacheado (mesmo
  // padrão do E1_SYSTEM_ADDENDUM), depois do prompt-base cacheado.
  if (compiled) system.push({ type: "text", text: compiled.systemAddendum })

  const userContent: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: profileBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: tailBlock },
  ]
  if (digestBlock) userContent.push({ type: "text", text: digestBlock })

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: 400,
        temperature: 0,
        system,
        tools: [SYNOPSIS_QUALITY_TOOL],
        tool_choice: { type: "tool", name: SYNOPSIS_QUALITY_TOOL.name },
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      },
      {
        operation: "synopsis_quality_predict",
        promptVersion,
        attempt,
        workId: args.work.id,
      },
    )

    const toolUse = findToolUse(message, SYNOPSIS_QUALITY_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta cortada por max_tokens."
          : "Resposta não chamou a tool submit_synopsis_quality.",
      )
      continue
    }

    const parsed = synopsisQualityToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    return {
      predictedQuality: parsed.data.predicted_quality,
      justification: parsed.data.justification,
      confidence: parsed.data.confidence ?? null,
      modelName: MODEL,
      promptVersion,
      usage,
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao estimar Interesse Sinopse.")
}
