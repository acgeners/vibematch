// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Phase 1 of the tag sub-group pipeline.
 *
 * Reads every tag in a group and asks Claude to propose a small set of
 * broad, mutually-exclusive ORGANIZATIONAL sub-groups (e.g. for
 * "female_lead": Looks / Traits / Context) — NOT synonym clusters.
 * Proposals are persisted in `tag_subgroup` (status='pending') for human
 * review at `/settings/tag-consolidation?view=subgroups&phase=define`.
 *
 * Phase 2 (assigning tags into the approved sub-groups) lives in
 * `scripts/assign-tags-to-subgroups.js`.
 *
 * Usage:
 *   node scripts/propose-subgroups.js --group female_lead
 *   node scripts/propose-subgroups.js --all
 *
 * Envs auto-loaded from `.env.local`. Prerequisite: migration 044 applied.
 *
 * Idempotency: deletes prior `pending` sub-groups for the group before
 * inserting. `approved`/`rejected` rows are left untouched.
 */

const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") })

const { createClient } = require("@supabase/supabase-js")
const Anthropic = require("@anthropic-ai/sdk").default

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://djbreiyzwoevbmoscqiq.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required (set in .env.local or env).")
  process.exit(1)
}
if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is required (set in .env.local or env).")
  process.exit(1)
}

const args = process.argv.slice(2)
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
function hasFlag(name) {
  return args.includes(`--${name}`)
}
const GROUP = getArg("group", null)
const ALL = hasFlag("all")
const MODEL = "claude-sonnet-4-6"

if (!GROUP && !ALL) {
  console.error("ERROR: pass either --group <slug> (e.g. --group female_lead) or --all.")
  process.exit(1)
}
if (GROUP && ALL) {
  console.error("ERROR: --group and --all are mutually exclusive.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Slug helper — must match lib/utils.ts#slugifyTagName.
function slugifyTagName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

const SYSTEM_PROMPT = `You receive the name + description of a tag group and an alphabetical list of all tag names in it. Your task is to propose a SMALL set of broad, organizational SUB-GROUPS that partition the group's tags into navigable buckets, so a long flat tag list becomes collapsible/expandable.

These are NOT synonym clusters. You are not merging tags — you are designing category buckets that tags will later be sorted into.

Rules:
1. Propose between 2 and 5 sub-groups — aim for 3 or 4. Fewer is better: the whole point is a short, scannable set of buckets. Only reach 5 when the group is large and genuinely multi-faceted.
2. Sub-groups should be mutually exclusive (MECE) and collectively cover the conceptual space of the group, so almost every tag has an obvious home.
3. Each sub-group needs:
   - \`name\`: as short and generic as possible — prefer a SINGLE word (e.g. "Looks", "Traits", "Context", "Role", "Powers", "Status", "Species"). Title Case, at most two words, and avoid "&"/compound labels. Think broad category label, not a precise description.
   - \`description\`: one sentence describing exactly what kind of tag belongs here. This carries the precision the short name omits and guides the later assignment step, so be concrete and disambiguating.
   - \`rationale\`: one short sentence on why this bucket exists for this group.
   - \`confidence\`: 0.70–1.0. Lower if the bucket boundary is fuzzy.
4. Design buckets around the dominant AXES of variation in the actual tag list. For appearance/personality archetype groups (e.g. "X Female Lead"), good axes are typically "Looks", "Traits", and "Context" (background/status). For activity/theme groups, axes are usually broad domains (e.g. "Sports", "Arts", "Domestic", "Business").
5. Do NOT invent buckets for concepts absent from the list. Ground every bucket in tags you actually see.
6. Respond ONLY via the \`propose_subgroups\` tool.`

const TOOL = {
  name: "propose_subgroups",
  description:
    "Returns the proposed organizational sub-groups for the group. Always use this tool to respond; never write free-form text outside it.",
  input_schema: {
    type: "object",
    properties: {
      subgroups: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            rationale: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["name", "description", "rationale", "confidence"],
        },
      },
    },
    required: ["subgroups"],
  },
}

async function fetchGroup(groupSlug) {
  const { data: groups, error: gErr } = await supabase
    .from("tag_group")
    .select('id, slug, "group", description, example')
    .eq("slug", groupSlug)
    .limit(1)
  if (gErr) throw gErr
  if (!groups || groups.length === 0) throw new Error(`tag_group "${groupSlug}" not found`)
  const group = groups[0]

  const all = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, slug, name")
      .eq("tag_group_id", group.id)
      .order("name", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return { group, tags: all }
}

async function callClaude(group, tagNames) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const sorted = [...tagNames].sort((a, b) => a.localeCompare(b))
  const baseMessage =
    `Group: ${group.group} (slug: ${group.slug})\n` +
    (group.description ? `Group definition: ${group.description}\n` : "") +
    (group.example ? `Examples: ${group.example}\n` : "") +
    `Total tags: ${sorted.length}\n\n` +
    `Tag names (one per line):\n` +
    sorted.join("\n")

  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? baseMessage
        : baseMessage +
          `\n\nReconsider: propose a clean, mutually-exclusive set of just 3–4 buckets with short, generic one-word names that covers this list. Avoid overlap and avoid singletons.`
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        temperature: attempt === 0 ? 0.3 : 0,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: userMessage }],
      })
      console.log(
        `  attempt ${attempt + 1}: stop_reason=${message.stop_reason} tokens=${message.usage.input_tokens}/${message.usage.output_tokens}`,
      )
      const toolUse = message.content.find((b) => b.type === "tool_use")
      if (!toolUse) throw new Error("model returned no tool_use block")
      const payload = toolUse.input
      if (!payload || !Array.isArray(payload.subgroups) || payload.subgroups.length < 2) {
        throw new Error(`invalid tool payload (stop_reason=${message.stop_reason})`)
      }
      return { subgroups: payload.subgroups, usage: message.usage }
    } catch (err) {
      lastError = err
      if (attempt === 1) break
    }
  }
  throw new Error(
    `Claude call failed: ${lastError && lastError.message ? lastError.message : String(lastError)}`,
  )
}

async function processGroup(groupSlug) {
  console.log(`[propose-subgroups] group=${groupSlug}`)
  const { group, tags } = await fetchGroup(groupSlug)
  console.log(`[propose-subgroups] ${tags.length} tags in group "${groupSlug}".`)

  if (tags.length < 4) {
    console.log(`[propose-subgroups] too few tags to bucket — skipping.`)
    return { tags: tags.length, subgroups: 0, tokensIn: 0, tokensOut: 0, status: "skip" }
  }

  console.log(`[propose-subgroups] calling Claude (${MODEL})...`)
  const { subgroups: raw, usage } = await callClaude(group, tags.map((t) => t.name))
  console.log(`[propose-subgroups] received ${raw.length} sub-groups.`)

  // Build rows, dedupe slugs.
  const seenSlug = new Set()
  const rows = []
  for (let i = 0; i < raw.length; i++) {
    const sg = raw[i]
    const name = String(sg.name || "").trim()
    if (!name) continue
    let slug = slugifyTagName(name)
    if (!slug) continue
    if (seenSlug.has(slug)) slug = `${slug}-${i}`
    seenSlug.add(slug)
    rows.push({
      tag_group_id: group.id,
      group_slug: groupSlug,
      name,
      slug,
      description: sg.description ? String(sg.description).trim() : null,
      rationale: sg.rationale ? String(sg.rationale).trim() : null,
      confidence: typeof sg.confidence === "number" ? sg.confidence : null,
      sort_order: i,
      status: "pending",
    })
  }

  if (rows.length === 0) {
    console.log(`[propose-subgroups] nothing to insert.`)
    return {
      tags: tags.length, subgroups: 0,
      tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, status: "ok",
    }
  }

  // Wipe prior pending sub-groups for this group.
  const { error: delErr } = await supabase
    .from("tag_subgroup")
    .delete()
    .eq("group_slug", groupSlug)
    .eq("status", "pending")
  if (delErr) throw delErr

  const { error: insErr } = await supabase.from("tag_subgroup").insert(rows)
  if (insErr) throw insErr

  console.log(`[propose-subgroups] DONE for "${groupSlug}". Inserted ${rows.length} sub-groups:`)
  for (const r of rows) console.log(`  - ${r.name}  (${r.slug})`)

  return {
    tags: tags.length,
    subgroups: rows.length,
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens,
    status: "ok",
  }
}

async function fetchAllGroupSlugs() {
  const { data, error } = await supabase
    .from("tag_group")
    .select("slug")
    .order("slug", { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => r.slug)
}

async function main() {
  if (!ALL) {
    await processGroup(GROUP)
    return
  }

  const slugs = await fetchAllGroupSlugs()
  console.log(`[propose-subgroups] --all: ${slugs.length} groups\n`)

  const summary = []
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    console.log(`\n[${i + 1}/${slugs.length}] ====== ${slug} ======`)
    try {
      const result = await processGroup(slug)
      summary.push({ group: slug, ...result })
    } catch (err) {
      console.error(`[propose-subgroups] FAILED group "${slug}":`, err && err.message ? err.message : err)
      summary.push({ group: slug, tags: 0, subgroups: 0, tokensIn: 0, tokensOut: 0, status: "fail" })
    }
  }

  console.log(`\n\n========== SUMMARY ==========`)
  const totals = { tags: 0, subgroups: 0, tokensIn: 0, tokensOut: 0 }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`${pad("group", 28)} ${pad("tags", 6)} ${pad("subgroups", 10)} status`)
  console.log("-".repeat(60))
  for (const row of summary) {
    totals.tags += row.tags
    totals.subgroups += row.subgroups
    totals.tokensIn += row.tokensIn
    totals.tokensOut += row.tokensOut
    console.log(`${pad(row.group, 28)} ${pad(row.tags, 6)} ${pad(row.subgroups, 10)} ${row.status}`)
  }
  console.log("-".repeat(60))
  console.log(`${pad("TOTAL", 28)} ${pad(totals.tags, 6)} ${pad(totals.subgroups, 10)}`)
  console.log(`Tokens: in=${totals.tokensIn} out=${totals.tokensOut}`)
}

main().catch((err) => {
  console.error(`[propose-subgroups] FAILED`, err)
  process.exit(1)
})
