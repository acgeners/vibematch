import "server-only"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { createAdminClient } from "@/lib/supabase/admin"

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const MODEL = "claude-haiku-4-5-20251001"

// Grupos inferíveis da sinopse, incluídos por inteiro (menos o subgrupo "Looks").
const INCLUDED_FULL = new Set([
  "tone_mood", "romance", "relationship_dynamics", "conflict", "themes", "setting",
  "fantasy", "scifi", "social_political", "content_indicator",
  "female_lead", "male_lead", "superpowers",
])
// Ordem de exibição no prompt (character_profile entra só pelo subgrupo "Role").
const GROUP_ORDER = [
  "tone_mood", "romance", "relationship_dynamics", "themes", "conflict", "setting",
  "fantasy", "scifi", "social_political", "superpowers",
  "female_lead", "male_lead", "content_indicator", "character_profile",
]
const MIN_USAGE = 3

export interface TagMenu {
  /** System prompt completo (instruções + menu agrupado), idêntico entre chamadas → cacheável. */
  systemPrompt: string
  /** lower(name) → nome canônico. Usado pra filtrar a saída do modelo ao vocabulário. */
  allowedByLower: Map<string, string>
  count: number
}

export interface InferredTag {
  name: string
  confidence: number
  evidence: string
}

async function pageAll<T = Record<string, unknown>>(
  sb: SupabaseAdmin, table: string, columns: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

function buildSystemPrompt(menuText: string): string {
  return `Você identifica tags de obras (manhwa, manhua, webtoon, light novel) a partir da SINOPSE.

Regras:
- Escolha APENAS tags da lista abaixo (vocabulário fechado). NUNCA invente tags nem use variações de nome.
- Só inclua uma tag se a sinopse a sustentar. Em caso de dúvida, NÃO inclua.
- Para cada tag, cite em "evidence" o trecho curto da sinopse que a justifica.
- Prefira precisão a cobertura: poucas tags certas valem mais que muitas duvidosas.
- confidence "alta" = a sinopse afirma claramente; "média" = fortemente sugerido, não explícito.

Tags permitidas, por dimensão (use o nome EXATO da lista):

${menuText}

Responda SEMPRE chamando a tool extract_tags.`
}

const INFER_TOOL = {
  name: "extract_tags",
  description: "Extrai as tags aplicáveis (apenas da lista permitida) com base na sinopse.",
  input_schema: {
    type: "object" as const,
    properties: {
      tags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag: { type: "string", description: "Nome EXATO de uma tag da lista permitida." },
            confidence: { type: "string", enum: ["alta", "média"] },
            evidence: { type: "string", description: "Trecho curto da sinopse que sustenta a tag." },
          },
          required: ["tag", "confidence", "evidence"],
        },
      },
    },
    required: ["tags"],
  },
}

export async function buildTagMenu(sb: SupabaseAdmin): Promise<TagMenu> {
  const groups = await pageAll<{ id: string; slug: string }>(sb, "tag_group", "id, slug")
  const slugById = new Map(groups.map((g) => [g.id, g.slug]))
  const subs = await pageAll<{ id: string; name: string; status: string | null }>(sb, "tag_subgroup", "id, name, status")
  const subName = new Map(subs.filter((s) => s.status !== "rejected").map((s) => [s.id, s.name]))
  const tags = await pageAll<{ id: string; name: string; tag_group_id: string | null; tag_subgroup_id: string | null }>(
    sb, "tags", "id, name, tag_group_id, tag_subgroup_id",
  )
  const wt = await pageAll<{ tag_id: string }>(sb, "work_tags", "tag_id")
  const use = new Map<string, number>()
  for (const r of wt) use.set(r.tag_id, (use.get(r.tag_id) ?? 0) + 1)

  const byGroup = new Map<string, Array<{ name: string; use: number }>>()
  const allowedByLower = new Map<string, string>()
  for (const t of tags) {
    if ((use.get(t.id) ?? 0) < MIN_USAGE) continue
    const gslug = t.tag_group_id ? slugById.get(t.tag_group_id) : undefined
    if (!gslug) continue
    const sname = t.tag_subgroup_id ? (subName.get(t.tag_subgroup_id) ?? null) : null
    if (sname === "Looks") continue
    const include = INCLUDED_FULL.has(gslug) || (gslug === "character_profile" && sname === "Role")
    if (!include) continue
    const arr = byGroup.get(gslug) ?? []
    arr.push({ name: t.name, use: use.get(t.id) ?? 0 })
    byGroup.set(gslug, arr)
    allowedByLower.set(t.name.trim().toLowerCase(), t.name)
  }

  const lines: string[] = []
  let count = 0
  for (const g of GROUP_ORDER) {
    const arr = byGroup.get(g)
    if (!arr || arr.length === 0) continue
    arr.sort((a, b) => b.use - a.use)
    count += arr.length
    lines.push(`- ${g}: ${arr.map((x) => x.name).join(", ")}`)
  }

  return { systemPrompt: buildSystemPrompt(lines.join("\n")), allowedByLower, count }
}

export async function inferTagsFromText(opts: {
  supabase: SupabaseAdmin
  synopsis: string
  menu: TagMenu
}): Promise<InferredTag[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[infer-tags] ANTHROPIC_API_KEY ausente; pulando")
    return []
  }
  const { menu, synopsis } = opts
  const client = getAnthropicClient({ maxRetries: 6 })
  const { message } = await createLoggedMessage(
    client,
    {
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: menu.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [INFER_TOOL],
      tool_choice: { type: "tool", name: INFER_TOOL.name },
      messages: [{ role: "user", content: `Sinopse da obra:\n\n${synopsis.trim()}` }],
    },
    { operation: "tag_inference", metadata: { nCandidates: menu.count } },
  )

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  )
  const raw = (toolUse?.input as { tags?: Array<{ tag?: string; confidence?: string; evidence?: string }> })?.tags ?? []

  const out: InferredTag[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const canonical = menu.allowedByLower.get((r.tag ?? "").trim().toLowerCase())
    if (!canonical) continue // fora do vocabulário → descarta
    if (!r.evidence || !r.evidence.trim()) continue // sem grounding → descarta
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push({
      name: canonical,
      confidence: /alta/i.test(r.confidence ?? "") ? 0.9 : 0.6,
      evidence: r.evidence.trim(),
    })
  }
  return out
}
