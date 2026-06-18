// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Audit tag-group classifications: for each tag, ask Claude if its
 * current group is the best fit given all group definitions. Insert
 * suggested moves into `tag_group_move_proposal` for human review.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/audit-tag-groups.js [--min-confidence 0.75] [--group <slug>]
 *
 * Prerequisites: migration 043 applied.
 *
 * Idempotent: deletes existing `pending` proposals before inserting new ones.
 */

const { createClient } = require("@supabase/supabase-js")
const Anthropic = require("@anthropic-ai/sdk").default
const { loggedCreate } = require("./lib/ai-log.js")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://djbreiyzwoevbmoscqiq.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required.")
  process.exit(1)
}
if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is required.")
  process.exit(1)
}

const args = process.argv.slice(2)
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const MIN_CONFIDENCE = Number(getArg("min-confidence", "0.75"))
const FILTER_GROUP = getArg("group", null)
const MODEL = "claude-sonnet-4-6"
const CHUNK_SIZE = 150

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function buildSystemPrompt(groups) {
  const defs = groups
    .map(
      (g) =>
        `- slug: "${g.slug}" | name: "${g.group}"\n` +
        `  description: ${g.description ?? "(no description)"}\n` +
        `  examples: ${g.example ?? "(no examples)"}`,
    )
    .join("\n")

  return `You audit tag-group classifications for a manga/light-novel ranking database.

You receive (a) the catalog of available tag groups below and (b) a batch of tags with their current group. Your task: for each tag, decide whether its current group is the best fit. If not, suggest a better group.

AVAILABLE TAG GROUPS:
${defs}

Rules:
1. Only emit a suggestion when you are confident (≥ 0.75) the current group is wrong AND a specific other group is clearly better.
2. Tags whose current group is correct, OR are ambiguous between groups: DO NOT include in the response. Leave them out entirely.
3. \`suggested_group_slug\` MUST be one of the slugs listed above. Do not invent new groups.
4. Brief \`rationale\` should cite the destination group's definition / examples.
5. Be conservative. "elements", "themes", "tone_mood" can overlap legitimately — only suggest moves with strong signal (e.g. clearly a character archetype mis-placed in "cast", clearly a setting mis-placed in "elements").
6. Respond ONLY via the \`propose_group_moves\` tool. Empty \`moves\` array is acceptable.

Coverage expectation: a healthy batch usually has 5–25% of tags flagged. Do not emit thousands; do not satisfice at zero unless the batch really has no errors.
`
}

const TOOL = {
  name: "propose_group_moves",
  description: "Returns the list of tags whose group should change.",
  input_schema: {
    type: "object",
    properties: {
      moves: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag_name: { type: "string" },
            suggested_group_slug: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
          required: ["tag_name", "suggested_group_slug", "confidence", "rationale"],
        },
      },
    },
    required: ["moves"],
  },
}

async function fetchGroups() {
  const { data, error } = await supabase
    .from("tag_group")
    .select("id, slug, group, description, example")
    .order("slug")
  if (error) throw error
  return data
}

async function fetchTags(filterGroupSlug) {
  const PAGE = 1000
  const all = []
  let query = supabase
    .from("tags")
    .select("id, name, slug, tag_group_id")
    .order("name")
  if (filterGroupSlug) {
    const { data: g, error: gErr } = await supabase
      .from("tag_group")
      .select("id")
      .eq("slug", filterGroupSlug)
      .single()
    if (gErr) throw gErr
    query = query.eq("tag_group_id", g.id)
  }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await query.range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function callChunk(client, systemPrompt, validGroupSlugs, tagsChunk) {
  const userMessage =
    `Batch size: ${tagsChunk.length}\n\nTags (one per line, format: NAME [current_group]):\n` +
    tagsChunk.map((t) => `${t.name} [${t.current_group_slug}]`).join("\n")

  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    const finalMessage = attempt === 0
      ? userMessage
      : userMessage + `\n\nBe thorough — review each tag against the group definitions. If a batch truly has no mis-classifications, return moves: []. Do not satisfice at 0 or 1 if more are clearly available.`
    try {
      const message = await loggedCreate(client, supabase, {
        model: MODEL,
        max_tokens: 12000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: finalMessage }],
      }, { operation: "tag_audit", workloadType: "admin", metadata: { attempt } })
      console.log(`    stop_reason=${message.stop_reason} tokens=${message.usage.input_tokens}/${message.usage.output_tokens}`)
      const toolUse = message.content.find((b) => b.type === "tool_use")
      if (!toolUse) throw new Error("no tool_use")
      const payload = toolUse.input
      if (!payload || !Array.isArray(payload.moves)) {
        throw new Error(`invalid payload (stop_reason=${message.stop_reason})`)
      }
      // Filter invalid group slugs and low confidence in one pass.
      const cleaned = payload.moves.filter(
        (m) =>
          validGroupSlugs.has(m.suggested_group_slug) &&
          typeof m.confidence === "number" &&
          m.confidence >= MIN_CONFIDENCE,
      )
      // If model returned 0 in a sizeable batch on first attempt, retry once.
      if (attempt === 0 && cleaned.length === 0 && tagsChunk.length >= 50) {
        console.log(`    zero moves in batch of ${tagsChunk.length}; retrying once with nudge...`)
        lastError = new Error("zero moves first attempt")
        continue
      }
      return { moves: cleaned, usage: message.usage }
    } catch (err) {
      lastError = err
      if (attempt === 1) break
    }
  }
  throw new Error(`audit chunk failed: ${lastError && lastError.message ? lastError.message : String(lastError)}`)
}

async function main() {
  console.log(`[audit-tag-groups] min_confidence=${MIN_CONFIDENCE}${FILTER_GROUP ? ` group=${FILTER_GROUP}` : " (all groups)"}`)
  const groups = await fetchGroups()
  const validSlugs = new Set(groups.map((g) => g.slug))
  const groupIdToSlug = new Map(groups.map((g) => [g.id, g.slug]))
  console.log(`[audit-tag-groups] ${groups.length} groups loaded.`)

  const tags = await fetchTags(FILTER_GROUP)
  console.log(`[audit-tag-groups] ${tags.length} tags to audit.`)
  if (tags.length === 0) return

  const enriched = tags.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    current_group_slug: groupIdToSlug.get(t.tag_group_id) ?? "unknown",
  }))
  const nameToTag = new Map(enriched.map((t) => [t.name.toLowerCase(), t]))

  const systemPrompt = buildSystemPrompt(groups)
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const chunks = []
  for (let i = 0; i < enriched.length; i += CHUNK_SIZE) {
    chunks.push(enriched.slice(i, i + CHUNK_SIZE))
  }
  console.log(`[audit-tag-groups] ${chunks.length} chunk(s) of up to ${CHUNK_SIZE} tags.`)

  const allMoves = []
  let totalInput = 0
  let totalOutput = 0
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  chunk ${i + 1}/${chunks.length} (${chunks[i].length} tags):`)
    const { moves, usage } = await callChunk(client, systemPrompt, validSlugs, chunks[i])
    allMoves.push(...moves)
    totalInput += usage.input_tokens
    totalOutput += usage.output_tokens
  }
  console.log(`[audit-tag-groups] raw moves: ${allMoves.length} (tokens: ${totalInput}/${totalOutput})`)

  // Resolve tag_id, drop unknowns, drop no-op moves.
  const proposals = []
  let droppedUnknown = 0
  let droppedNoop = 0
  const seenTagIds = new Set()
  for (const m of allMoves) {
    const tag = nameToTag.get(String(m.tag_name).toLowerCase())
    if (!tag) {
      droppedUnknown += 1
      continue
    }
    if (tag.current_group_slug === m.suggested_group_slug) {
      droppedNoop += 1
      continue
    }
    if (seenTagIds.has(tag.id)) continue // first wins
    seenTagIds.add(tag.id)
    proposals.push({
      tag_id: tag.id,
      current_group_slug: tag.current_group_slug,
      suggested_group_slug: m.suggested_group_slug,
      confidence: m.confidence,
      rationale: m.rationale,
      status: "pending",
    })
  }
  console.log(`[audit-tag-groups] valid proposals: ${proposals.length}`)
  if (droppedUnknown) console.log(`  dropped (tag name not found): ${droppedUnknown}`)
  if (droppedNoop) console.log(`  dropped (suggested == current): ${droppedNoop}`)

  if (proposals.length === 0) {
    console.log(`[audit-tag-groups] nothing to insert.`)
    return
  }

  // Wipe prior pending and insert.
  const { error: delErr } = await supabase
    .from("tag_group_move_proposal")
    .delete()
    .eq("status", "pending")
  if (delErr) throw delErr

  const INSERT_CHUNK = 100
  for (let i = 0; i < proposals.length; i += INSERT_CHUNK) {
    const slice = proposals.slice(i, i + INSERT_CHUNK)
    const { error } = await supabase.from("tag_group_move_proposal").insert(slice)
    if (error) throw error
  }

  // Top transitions summary.
  const tally = new Map()
  for (const p of proposals) {
    const k = `${p.current_group_slug} → ${p.suggested_group_slug}`
    tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  console.log(`\n[audit-tag-groups] DONE. ${proposals.length} proposals inserted.`)
  console.log(`  Top transitions:`)
  for (const [k, n] of top) console.log(`    ${k}: ${n}`)
}

main().catch((err) => {
  console.error(`[audit-tag-groups] FAILED`, err)
  process.exit(1)
})
