import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { ACTIVE_MODELS } from "@/lib/ai/models"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { providerDetailOf, providerOutcomeOf } from "@/lib/tags/enrichment-status"
import type { ProviderOutcome } from "@/lib/tags/enrichment-status"

const MODEL = ACTIVE_MODELS.haiku

interface TagGroupRow {
  id: string
  slug: string
  group: string | null
  description: string | null
  example: string | null
}

interface ClassifierInput {
  tagNames: string[]
}

export interface TagClassification {
  /**
   * Nome → tag_group_id, SÓ para os nomes que o modelo de fato classificou com um slug válido
   * (inclusive `other`, quando é o MODELO quem diz que nada encaixa). Nome ausente = não
   * classificado: quem chama NÃO deve inventar um grupo para ele.
   *
   * 🔴 Até a migration 210 este mapa vinha preenchido com `other` para todo nome quando a chamada
   * falhava — e a falha virava "decisão" no banco (ver `lib/tags/enrichment-status.ts`).
   */
  byName: Map<string, string>
  /** O que aconteceu com a chamada. */
  outcome: ProviderOutcome
  /** Motivo, quando `outcome` não é "ok". */
  detail: string | null
}

async function loadTagGroups(): Promise<TagGroupRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tag_group")
    .select("id, slug, group, description, example")
  if (error) {
    console.error("[tag-classifier] failed to load tag_group", error.message)
    return []
  }
  return (data ?? []) as TagGroupRow[]
}

function buildSystemPrompt(groups: TagGroupRow[]): string {
  const groupSection = groups
    .map((g) => {
      const parts = [`- ${g.slug}: ${g.group ?? g.slug}`]
      if (g.description?.trim()) parts.push(`  Descrição: ${g.description.trim()}`)
      if (g.example?.trim()) parts.push(`  Exemplos: ${g.example.trim()}`)
      return parts.join("\n")
    })
    .join("\n\n")

  return `Você categoriza tags de obras (mangás, manhwas, webtoons, novels) em grupos pré-definidos.

Grupos disponíveis (use o slug como resposta):

${groupSection}

Regras:
- Cada tag recebe exatamente um grupo, o mais específico possível.
- Se nenhum grupo descreve bem a tag, use o slug "other".
- Não invente grupos novos. Use apenas os slugs listados acima.
- Responda SEMPRE chamando a tool classify_tags.`
}

const CLASSIFIER_TOOL = {
  name: "classify_tags",
  description: "Classifica cada tag em um dos grupos disponíveis.",
  input_schema: {
    type: "object" as const,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag_name: { type: "string" },
            group_slug: { type: "string" },
          },
          required: ["tag_name", "group_slug"],
        },
      },
    },
    required: ["classifications"],
  },
}

async function callClassifier(
  systemPrompt: string,
  tagNames: string[]
): Promise<Array<{ tag_name: string; group_slug: string }>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Lançar (e não devolver []) é o que separa "não chamei" de "chamei e o modelo não classificou".
    throw new Error("ANTHROPIC_API_KEY ausente: classificador de grupo não chamado")
  }

  const client = getAnthropicClient({ maxRetries: 6 })
  const { message } = await createLoggedMessage(
    client,
    {
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [CLASSIFIER_TOOL],
      tool_choice: { type: "tool", name: CLASSIFIER_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Classifique as tags abaixo:\n\n${tagNames.map((n) => `- ${n}`).join("\n")}`,
        },
      ],
    },
    {
      operation: "tag_classifier",
      metadata: { nTags: tagNames.length },
    },
  )

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use"
  )
  if (!toolUse) return []

  const input = toolUse.input as { classifications?: Array<{ tag_name: string; group_slug: string }> }
  return input.classifications ?? []
}

export async function classifyTagsByGroup({ tagNames }: ClassifierInput): Promise<TagClassification> {
  const result: TagClassification = { byName: new Map(), outcome: "ok", detail: null }
  if (tagNames.length === 0) return result

  const groups = await loadTagGroups()
  if (groups.length === 0) {
    // Sem a lista de grupos não há prompt — e nada foi chamado.
    return { ...result, outcome: "provider_not_called", detail: "tag_group não carregou" }
  }
  const idBySlug = new Map(groups.map((g) => [g.slug, g.id]))

  let classifications: Array<{ tag_name: string; group_slug: string }> = []
  try {
    classifications = await callClassifier(buildSystemPrompt(groups), tagNames)
  } catch (error) {
    const outcome = providerOutcomeOf(error)
    console.error(`[tag-classifier] ${outcome}: nenhum grupo atribuído`, error)
    return { ...result, outcome, detail: providerDetailOf(error) }
  }

  // Slug fora da lista e nome omitido ficam FORA do mapa: o modelo não decidiu sobre eles.
  for (const c of classifications) {
    const groupId = idBySlug.get(c.group_slug)
    if (groupId && tagNames.includes(c.tag_name)) result.byName.set(c.tag_name, groupId)
  }
  return result
}
