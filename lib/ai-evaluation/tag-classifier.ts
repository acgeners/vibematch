import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { ACTIVE_MODELS } from "@/lib/ai/models"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"

// Fallback tag_group when classification can't decide or fails.
const OTHER_TAG_GROUP_ID = "606e6239-515b-46c5-b985-9f41f948cdc9"

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
  /** Name → tag_group_id. Always defined for every input name. */
  byName: Map<string, string>
  /** ID of the fallback group used when a name couldn't be classified. */
  fallbackGroupId: string
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
    console.warn("[tag-classifier] ANTHROPIC_API_KEY ausente; usando fallback")
    return []
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
  const result: TagClassification = {
    byName: new Map(),
    fallbackGroupId: OTHER_TAG_GROUP_ID,
  }
  if (tagNames.length === 0) return result

  const groups = await loadTagGroups()
  const idBySlug = new Map(groups.map((g) => [g.slug, g.id]))
  const otherId = idBySlug.get("other") ?? OTHER_TAG_GROUP_ID
  result.fallbackGroupId = otherId

  if (groups.length === 0) {
    for (const name of tagNames) result.byName.set(name, otherId)
    return result
  }

  let classifications: Array<{ tag_name: string; group_slug: string }> = []
  try {
    classifications = await callClassifier(buildSystemPrompt(groups), tagNames)
  } catch (error) {
    console.error("[tag-classifier] classifier failed; usando fallback", error)
  }

  const byNameRaw = new Map(classifications.map((c) => [c.tag_name, c.group_slug]))
  for (const name of tagNames) {
    const slug = byNameRaw.get(name)
    const groupId = slug ? idBySlug.get(slug) : undefined
    result.byName.set(name, groupId ?? otherId)
  }
  return result
}
