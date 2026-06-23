// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Phase 2 of the tag sub-group pipeline.
 *
 * For a group whose sub-groups were already approved (Phase 1), asks Claude
 * to assign every tag to exactly one approved sub-group (or leave it out).
 * Proposals land in `tag_subgroup_assignment` (status='pending') for human
 * review at `/settings/tag-consolidation?view=subgroups&phase=assign`.
 * Applying approved assignments writes `tags.tag_subgroup_id`.
 *
 * Usage:
 *   node scripts/assign-tags-to-subgroups.js --group female_lead
 *   node scripts/assign-tags-to-subgroups.js --all
 *
 * Envs auto-loaded from `.env.local`. Prerequisites: migration 044 +
 * approved sub-groups for the group (run scripts/propose-subgroups.js and
 * approve them first).
 *
 * Idempotency: deletes prior `pending`/`rejected` assignments for the group;
 * tags already `approved`/`applied` are left untouched (human decisions kept).
 */

const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") })

const { createClient } = require("@supabase/supabase-js")
const Anthropic = require("@anthropic-ai/sdk").default
const { loggedCreate } = require("./lib/ai-log.js")

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
const BATCH = Number(getArg("batch", "150"))
const MODEL = "claude-sonnet-4-6"

if (!GROUP && !ALL) {
  console.error("ERROR: pass either --group <slug> or --all.")
  process.exit(1)
}
if (GROUP && ALL) {
  console.error("ERROR: --group and --all are mutually exclusive.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SYSTEM_PROMPT = `You receive a tag group, its approved SUB-GROUPS (each with a name, slug and description), and a list of tag names. Assign each tag to the single best-fitting sub-group.

Rules:
1. Every tag gets exactly one \`subgroup_slug\`, chosen from the provided list — or the literal "none" if no sub-group fits well.
2. Use the sub-group DESCRIPTIONS as the source of truth for what belongs where. When a tag could fit two buckets, pick the one whose description matches its PRIMARY meaning.
3. \`confidence\`: 0.90+ obvious fit; 0.70–0.89 reasonable; below 0.70 use "none" instead of forcing a bad fit.
4. Return one entry per input tag — do not skip, duplicate, or invent tag names.
5. Respond ONLY via the \`assign_tags\` tool.`

const TOOL = {
  name: "assign_tags",
  description:
    "Returns the sub-group assignment for each input tag. Always use this tool to respond; never write free-form text outside it.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag_name: { type: "string" },
            subgroup_slug: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["tag_name", "subgroup_slug", "confidence"],
        },
      },
    },
    required: ["assignments"],
  },
}

async function fetchGroupId(groupSlug) {
  const { data, error } = await supabase
    .from("tag_group")
    .select("id")
    .eq("slug", groupSlug)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`tag_group "${groupSlug}" not found`)
  return data[0].id
}

async function fetchApprovedSubgroups(groupSlug) {
  const { data, error } = await supabase
    .from("tag_subgroup")
    .select("id, name, slug, description")
    .eq("group_slug", groupSlug)
    .eq("status", "approved")
    .order("sort_order", { ascending: true })
  if (error) throw error
  return data ?? []
}

async function fetchTagsInGroup(groupId) {
  const all = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, slug, name")
      .eq("tag_group_id", groupId)
      .order("name", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function callClaude(groupSlug, subgroups, tagNames) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const subgroupBlock = subgroups
    .map((s) => `- ${s.slug}: ${s.name}${s.description ? ` — ${s.description}` : ""}`)
    .join("\n")
  const fixedContext =
    `Group: ${groupSlug}\n\n` +
    `Approved sub-groups (assign tags into these slugs, or "none"):\n${subgroupBlock}`

  const userMessage =
    `Tags to assign (one per line):\n${[...tagNames].sort((a, b) => a.localeCompare(b)).join("\n")}`

  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await loggedCreate(client, supabase, {
        model: MODEL,
        max_tokens: 8000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          // Sub-group context is stable across batches of the same group — cache it.
          { type: "text", text: fixedContext, cache_control: { type: "ephemeral" } },
        ],
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: userMessage }],
      }, { operation: "tag_subgroup_assign", workloadType: "admin", metadata: { attempt } })
      console.log(
        `    attempt ${attempt + 1}: stop_reason=${message.stop_reason} tokens=${message.usage.input_tokens}/${message.usage.output_tokens}`,
      )
      const toolUse = message.content.find((b) => b.type === "tool_use")
      if (!toolUse) throw new Error("model returned no tool_use block")
      const payload = toolUse.input
      if (!payload || !Array.isArray(payload.assignments)) {
        throw new Error(`invalid tool payload (stop_reason=${message.stop_reason})`)
      }
      return { assignments: payload.assignments, usage: message.usage }
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
  console.log(`[assign-tags] group=${groupSlug}`)
  const subgroups = await fetchApprovedSubgroups(groupSlug)
  if (subgroups.length === 0) {
    console.log(`[assign-tags] no APPROVED sub-groups — run propose-subgroups and approve them first. Skipping.`)
    return { tags: 0, assigned: 0, none: 0, tokensIn: 0, tokensOut: 0, status: "skip" }
  }
  console.log(`[assign-tags] ${subgroups.length} approved sub-groups: ${subgroups.map((s) => s.slug).join(", ")}`)

  const groupId = await fetchGroupId(groupSlug)
  const tags = await fetchTagsInGroup(groupId)
  console.log(`[assign-tags] ${tags.length} tags in group.`)
  if (tags.length === 0) return { tags: 0, assigned: 0, none: 0, tokensIn: 0, tokensOut: 0, status: "skip" }

  // Skip tags whose assignment is already approved/applied (respect decisions).
  const { data: locked, error: lockedErr } = await supabase
    .from("tag_subgroup_assignment")
    .select("tag_id")
    .eq("group_slug", groupSlug)
    .in("status", ["approved", "applied"])
  if (lockedErr) throw lockedErr
  const lockedIds = new Set((locked ?? []).map((r) => r.tag_id))

  const nameToId = new Map()
  for (const t of tags) nameToId.set(t.name.toLowerCase(), t.id)
  const slugToSubgroupId = new Map()
  for (const s of subgroups) slugToSubgroupId.set(s.slug, s.id)

  const pending = tags.filter((t) => !lockedIds.has(t.id))
  console.log(`[assign-tags] ${pending.length} tags to (re)assign (${lockedIds.size} locked).`)

  const rows = []
  let noneCount = 0
  let tokensIn = 0
  let tokensOut = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${batch.length} tags`)
    const { assignments, usage } = await callClaude(groupSlug, subgroups, batch.map((t) => t.name))
    tokensIn += usage.input_tokens
    tokensOut += usage.output_tokens
    const seen = new Set()
    for (const a of assignments) {
      const tagId = nameToId.get(String(a.tag_name || "").toLowerCase())
      if (!tagId || seen.has(tagId) || lockedIds.has(tagId)) continue
      const slug = String(a.subgroup_slug || "").toLowerCase()
      if (slug === "none") {
        noneCount += 1
        seen.add(tagId)
        continue
      }
      const subgroupId = slugToSubgroupId.get(slug)
      if (!subgroupId) {
        noneCount += 1
        continue
      }
      seen.add(tagId)
      rows.push({
        tag_id: tagId,
        subgroup_id: subgroupId,
        group_slug: groupSlug,
        confidence: typeof a.confidence === "number" ? a.confidence : null,
        status: "pending",
      })
    }
  }

  // Wipe prior pending/rejected assignments for this group, then insert.
  const { error: delErr } = await supabase
    .from("tag_subgroup_assignment")
    .delete()
    .eq("group_slug", groupSlug)
    .in("status", ["pending", "rejected"])
  if (delErr) throw delErr

  if (rows.length > 0) {
    const CHUNK = 100
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("tag_subgroup_assignment").insert(rows.slice(i, i + CHUNK))
      if (error) throw error
    }
  }

  console.log(`[assign-tags] DONE for "${groupSlug}". Assigned ${rows.length}, none/unfit ${noneCount}.`)
  return {
    tags: tags.length,
    assigned: rows.length,
    none: noneCount,
    tokensIn,
    tokensOut,
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
  console.log(`[assign-tags] --all: ${slugs.length} groups\n`)
  const summary = []
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    console.log(`\n[${i + 1}/${slugs.length}] ====== ${slug} ======`)
    try {
      summary.push({ group: slug, ...(await processGroup(slug)) })
    } catch (err) {
      console.error(`[assign-tags] FAILED group "${slug}":`, err && err.message ? err.message : err)
      summary.push({ group: slug, tags: 0, assigned: 0, none: 0, tokensIn: 0, tokensOut: 0, status: "fail" })
    }
  }
  console.log(`\n\n========== SUMMARY ==========`)
  const totals = { assigned: 0, none: 0, tokensIn: 0, tokensOut: 0 }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`${pad("group", 28)} ${pad("assigned", 10)} ${pad("none", 6)} status`)
  console.log("-".repeat(60))
  for (const row of summary) {
    totals.assigned += row.assigned
    totals.none += row.none
    totals.tokensIn += row.tokensIn
    totals.tokensOut += row.tokensOut
    console.log(`${pad(row.group, 28)} ${pad(row.assigned, 10)} ${pad(row.none, 6)} ${row.status}`)
  }
  console.log("-".repeat(60))
  console.log(`${pad("TOTAL", 28)} ${pad(totals.assigned, 10)} ${pad(totals.none, 6)}`)
  console.log(`Tokens: in=${totals.tokensIn} out=${totals.tokensOut}`)
}

main().catch((err) => {
  console.error(`[assign-tags] FAILED`, err)
  process.exit(1)
})
