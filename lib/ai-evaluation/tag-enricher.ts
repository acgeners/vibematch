import "server-only"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"

const MODEL = "claude-haiku-4-5-20251001"

export interface EnrichInputTag {
  name: string
  slug: string
}

export interface EnrichResult {
  /** slug of an approved sub-group of the group, or null if none fits. */
  subgroupSlug: string | null
  /** slug of an existing tag this one is a near-synonym of, or null. */
  synonymOfSlug: string | null
  confidence: number
}

export interface EnrichTagsForGroupInput {
  groupSlug: string
  groupName: string
  newTags: EnrichInputTag[]
  approvedSubgroups: Array<{ slug: string; name: string; description: string | null }>
  existingTags: EnrichInputTag[]
}

interface RawClassification {
  tag_name: string
  subgroup_slug?: string | null
  synonym_of_slug?: string | null
  confidence?: number | null
}

const ENRICH_TOOL = {
  name: "enrich_tags",
  description: "Atribui sub-grupo e detecta sinônimos para cada tag nova.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag_name: { type: "string" },
            subgroup_slug: { type: "string", description: "slug de um sub-grupo da lista, ou \"none\"." },
            synonym_of_slug: { type: "string", description: "slug de uma tag existente da qual esta é sinônimo claro, ou \"none\"." },
            confidence: { type: "number", description: "0–1, confiança no sinônimo (use a do sub-grupo se não houver sinônimo)." },
          },
          required: ["tag_name", "subgroup_slug", "synonym_of_slug", "confidence"],
        },
      },
    },
    required: ["results"],
  },
}

function buildSystemPrompt(input: EnrichTagsForGroupInput): string {
  const subSection = input.approvedSubgroups.length
    ? input.approvedSubgroups
        .map((s) => `- ${s.slug}: ${s.name}${s.description ? ` — ${s.description}` : ""}`)
        .join("\n")
    : "(este grupo não tem sub-grupos — use \"none\" em subgroup_slug)"

  const existingSection = input.existingTags.length
    ? input.existingTags.map((t) => `- ${t.slug}: ${t.name}`).join("\n")
    : "(nenhuma tag existente — use \"none\" em synonym_of_slug)"

  return `Você enriquece tags novas de um grupo de tags de obras (mangás/manhwas/webtoons/novels). Para cada tag nova você faz DUAS coisas:

1. SUB-GRUPO: escolha o slug do sub-grupo (da lista abaixo) que melhor descreve a tag, usando as descrições como fonte de verdade. Se nenhum encaixa bem, use "none".
2. SINÔNIMO: diga se a tag é um SINÔNIMO CLARO de alguma tag JÁ EXISTENTE do grupo (mesmo conceito, redação diferente — ex.: "abandoned-fl" ↔ "abandoned-protagonist"). Se for, retorne o slug da tag existente em synonym_of_slug; senão "none". NÃO marque como sinônimo tags que apenas compartilham um atributo mas têm significado diferente (ex.: "blonde-protagonist" vs "blonde-villain").

confidence (0–1): confiança no SINÔNIMO quando houver; sem sinônimo, a confiança da escolha do sub-grupo.

Grupo: ${input.groupName} (${input.groupSlug})

Sub-grupos aprovados:
${subSection}

Tags já existentes no grupo (alvos possíveis de sinônimo):
${existingSection}

Regras: responda SEMPRE chamando a tool enrich_tags, com uma entrada por tag nova. Use apenas slugs das listas acima (ou "none").`
}

// Returns a map keyed by new-tag name. Names not returned by the model get a
// neutral result (no sub-group, no synonym).
export async function enrichTagsForGroup(
  input: EnrichTagsForGroupInput,
): Promise<Map<string, EnrichResult>> {
  const out = new Map<string, EnrichResult>()
  for (const t of input.newTags) {
    out.set(t.name, { subgroupSlug: null, synonymOfSlug: null, confidence: 0 })
  }
  if (input.newTags.length === 0) return out
  if (!process.env.ANTHROPIC_API_KEY) return out

  const subSlugs = new Set(input.approvedSubgroups.map((s) => s.slug))
  const existingSlugs = new Set(input.existingTags.map((t) => t.slug))

  let raw: RawClassification[] = []
  try {
    const client = getAnthropicClient({ maxRetries: 4 })
    const { message } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: "text", text: buildSystemPrompt(input), cache_control: { type: "ephemeral" } }],
        tools: [ENRICH_TOOL],
        tool_choice: { type: "tool", name: ENRICH_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Enriqueça as tags novas:\n\n${input.newTags.map((t) => `- ${t.name}`).join("\n")}`,
          },
        ],
      },
      { operation: "tag_enricher", metadata: { groupSlug: input.groupSlug, nTags: input.newTags.length } },
    )
    const toolUse = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    )
    const payload = toolUse?.input as { results?: RawClassification[] } | undefined
    raw = payload?.results ?? []
  } catch (error) {
    console.error("[tag-enricher] failed; sem enriquecimento", error)
    return out
  }

  for (const r of raw) {
    if (!r.tag_name || !out.has(r.tag_name)) continue
    const subgroupSlug = r.subgroup_slug && subSlugs.has(r.subgroup_slug) ? r.subgroup_slug : null
    const synonymOfSlug = r.synonym_of_slug && existingSlugs.has(r.synonym_of_slug) ? r.synonym_of_slug : null
    const confidence = typeof r.confidence === "number" ? r.confidence : 0
    out.set(r.tag_name, { subgroupSlug, synonymOfSlug, confidence })
  }
  return out
}
