import "server-only"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"
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

/**
 * Monta o contexto de leitores p/ a inferência de tags: prefere o DIGEST
 * estruturado (consensus + salient_traits + content_warnings), cai no resumo-texto.
 * Mesmo formato validado na passada `--with-reviews` (reviews puxam tags que a
 * sinopse omite — Cold Female Lead, Power Couple, content). `undefined` = sem
 * contexto (a inferência roda só com a sinopse).
 */
export function buildReviewContext(summary: unknown, digest: unknown): string | undefined {
  const parts: string[] = []
  const join = (v: unknown) => (Array.isArray(v) ? v.map(String).join("; ") : v ? String(v) : "")
  if (digest && typeof digest === "object") {
    const d = digest as Record<string, unknown>
    if (d.consensus) parts.push(`Consenso dos leitores: ${String(d.consensus)}`)
    if (d.salient_traits) parts.push(`Traços salientes: ${join(d.salient_traits)}`)
    if (d.content_warnings) parts.push(`Avisos de conteúdo: ${join(d.content_warnings)}`)
  }
  if (parts.length === 0 && summary && String(summary).trim()) parts.push(`Resumo das reviews: ${String(summary).trim()}`)
  return parts.length ? parts.join("\n") : undefined
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
- Só inclua uma tag se o TEXTO fornecido (sinopse e, quando houver, reviews de leitores) a sustentar. Em caso de dúvida, NÃO inclua.
- Para cada tag, cite em "evidence" o trecho curto (da sinopse ou das reviews) que a justifica.
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
  /** Contexto adicional (resumo/digest de reviews) — usado como evidência extra quando presente. */
  reviewContext?: string
}): Promise<InferredTag[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[infer-tags] ANTHROPIC_API_KEY ausente; pulando")
    return []
  }
  const { menu, synopsis, reviewContext } = opts
  const userContent = `Sinopse da obra:\n\n${synopsis.trim()}` +
    (reviewContext && reviewContext.trim()
      ? `\n\n--- Contexto adicional (reviews de leitores) ---\n${reviewContext.trim()}`
      : "")
  const client = getAnthropicClient({ maxRetries: 6 })
  const { message } = await createLoggedMessage(
    client,
    {
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: menu.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [INFER_TOOL],
      tool_choice: { type: "tool", name: INFER_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    },
    { operation: "tag_inference", metadata: { nCandidates: menu.count, withReviews: !!reviewContext } },
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

// ---- Verificação (2º olhar, modelo mais forte e estrito) --------------------

const VERIFY_MODEL = SONNET_MODEL

const VERIFY_TOOL = {
  name: "verify_tags",
  description: "Julga, para cada tag candidata, se a sinopse a sustenta de forma concreta.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag: { type: "string", description: "A tag candidata, exatamente como recebida." },
            supported: { type: "boolean", description: "true SÓ se a sinopse sustenta concretamente." },
            evidence: { type: "string", description: "Trecho da sinopse que sustenta (quando supported=true)." },
          },
          required: ["tag", "supported", "evidence"],
        },
      },
    },
    required: ["results"],
  },
}

/**
 * Revisor independente e RIGOROSO: recebe a sinopse + tags candidatas (sem saber
 * a confiança original) e confirma só as concretamente sustentadas. Sonnet 4.6.
 * Retorna as confirmadas com confidence 0.7 ("média verificada").
 */
export async function verifyTagsFromText(opts: {
  synopsis: string
  candidates: string[]
}): Promise<InferredTag[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[verify-tags] ANTHROPIC_API_KEY ausente; pulando")
    return []
  }
  if (opts.candidates.length === 0) return []
  const candByLower = new Map(opts.candidates.map((c) => [c.trim().toLowerCase(), c]))

  const system = `Você é um revisor RIGOROSO de tags de obras (manhwa, webtoon, novel).
Para CADA tag candidata, decida se a SINOPSE fornece suporte CONCRETO e específico para ela.
- supported=true SOMENTE se a sinopse sustenta a tag de forma clara — não por suposição genérica de gênero.
- Na dúvida, supported=false. Prefira REJEITAR a aceitar.
- Quando supported=true, cite em "evidence" o trecho exato da sinopse.
Julgue cada candidata de forma independente. Responda SEMPRE chamando verify_tags.`

  const user = `Sinopse:\n\n${opts.synopsis.trim()}\n\nTags candidatas (julgue cada uma):\n${opts.candidates.map((c) => `- ${c}`).join("\n")}`

  const client = getAnthropicClient({ maxRetries: 6 })
  const { message } = await createLoggedMessage(
    client,
    {
      model: VERIFY_MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [VERIFY_TOOL],
      tool_choice: { type: "tool", name: VERIFY_TOOL.name },
      messages: [{ role: "user", content: user }],
    },
    { operation: "tag_verify", metadata: { nCandidates: opts.candidates.length } },
  )

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  )
  const results = (toolUse?.input as { results?: Array<{ tag?: string; supported?: boolean; evidence?: string }> })?.results ?? []

  const out: InferredTag[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (r.supported !== true) continue
    const canonical = candByLower.get((r.tag ?? "").trim().toLowerCase())
    if (!canonical) continue // só confirma candidatas que de fato enviamos
    if (!r.evidence || !r.evidence.trim()) continue
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push({ name: canonical, confidence: 0.7, evidence: r.evidence.trim() })
  }
  return out
}
