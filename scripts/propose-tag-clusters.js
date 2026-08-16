// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Generate AI-proposed semantic tag clusters for a given group and
 * persist them in `tag_cluster_proposal` for human review via
 * `/settings/tag-consolidation`.
 *
 * Usage:
 *   node scripts/propose-tag-clusters.js --group characters [--min-confidence 0.7]
 *   node scripts/propose-tag-clusters.js --all              [--min-confidence 0.7]
 *
 * Envs are auto-loaded from `.env.local` at repo root.
 *
 * Prerequisites: migrations 040 + 041 applied.
 *
 * Idempotency: deletes prior `pending` proposals for the group
 * before inserting new ones. `approved` and `applied` proposals
 * are kept untouched (still consume their member tag ids).
 *
 * 🔴 ALVO: NUVEM — grava no CATÁLOGO (tags e propostas), que é compartilhado. Rodá-lo
 * contra o clone local perde o trabalho no próximo `db:pull`.
 *   node --env-file=.env.local scripts/propose-tag-clusters.js
 * ⚠️ Chama a Anthropic — o alvo não muda o custo; quem limita o dano é o escopo do lote.
 */

const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") })

const { createClient } = require("@supabase/supabase-js")
const Anthropic = require("@anthropic-ai/sdk").default
const { loggedCreate } = require("./lib/ai-log.js")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://obwlwukwovetgjqdpizd.supabase.co"
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

// CLI args
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
const MIN_CONFIDENCE = Number(getArg("min-confidence", "0.7"))
const MODEL = "claude-sonnet-4-6"

if (!GROUP && !ALL) {
  console.error("ERROR: pass either --group <slug> (e.g. --group characters) or --all.")
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

const SYSTEM_PROMPT = `You receive an alphabetically-sorted list of tag names that all belong to the same tag group (e.g. "characters", "cast", "elements"). Your task is to propose semantic clusters: groups of names that describe the same concept or highly overlapping tropes, so the database can collapse them into a single canonical tag.

Rules:
1. Each cluster MUST have ≥2 members (no singletons).
2. Do NOT merge orthogonal concepts. "blonde-protagonist" and "blonde-villain" share an attribute (hair color) but the role differs — keep them separate. Same for gender/age modifiers that change meaning.
3. \`canonical_name\` MUST be one of the existing member names — choose the most generic/representative. Do NOT invent new names.
4. \`confidence\`:
   - 0.95+ for clear paraphrases ("abused-female-lead" ↔ "abused-protagonist", same concept different wording).
   - 0.80–0.94 for strong synonyms with minor nuance differences.
   - 0.70–0.79 for defensible groupings where reasonable people might disagree.
   - Do NOT emit clusters with confidence < 0.70.
5. Tags you cannot confidently group should simply be absent from the response — leave them as-is.
6. Each member name appears in AT MOST one cluster.
7. Respond ONLY via the \`propose_clusters\` tool.

Common patterns to merge:
- Wording variants ("abandoned-protagonist" / "abandoned-mc" / "abandoned-fl").
- Singular/plural ("assassin" / "assassins").
- US/UK spellings ("colour" / "color").
- Role-equivalent synonyms ("mc" / "protagonist" / "main-character" when context is clear).

Common patterns NOT to merge:
- Different roles ("villain" vs "protagonist").
- Different genders if the existing taxonomy distinguishes them.
- Different specificity levels (don't merge "noble" with "duke" — duke is a kind of noble).

Coverage expectation:
- Most groups have between 10% and 40% of their tags in some synonym cluster.
- Don't satisfice by emitting just 1 or 2 clusters when more are clearly available — be thorough across the entire input list.
- For groups of personality/attribute tags (e.g. "X Female Lead"), look for adjective synonyms across the whole list: cold/aloof, strong/badass, naive/clueless/dense, shy/quiet/introverted, devoted/loyal, traumatized/scarred/abused, etc.
`

const TOOL = {
  name: "propose_clusters",
  description: "Returns the proposed semantic clusters. Always use this tool to respond; never write free-form text outside it.",
  input_schema: {
    type: "object",
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            canonical_name: { type: "string" },
            members: { type: "array", minItems: 2, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
          required: ["canonical_name", "members", "confidence", "rationale"],
        },
      },
    },
    required: ["clusters"],
  },
}

async function fetchTagsInGroup(groupSlug) {
  // tag_group has columns: id, slug. We need tag_group.id matching the slug.
  const { data: groups, error: gErr } = await supabase
    .from("tag_group")
    .select("id, slug")
    .eq("slug", groupSlug)
    .limit(1)
  if (gErr) throw gErr
  if (!groups || groups.length === 0) throw new Error(`tag_group "${groupSlug}" not found`)
  const groupId = groups[0].id

  const all = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, slug, name, tag_subgroup_id")
      .eq("tag_group_id", groupId)
      .order("name", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return { groupId, tags: all }
}

async function callClaude(groupSlug, tagNames) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const sorted = [...tagNames].sort((a, b) => a.localeCompare(b))
  const baseMessage =
    `Group: ${groupSlug}\n` +
    `Total tags: ${sorted.length}\n\n` +
    `Tag names (one per line):\n` +
    sorted.join("\n")

  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    // On retry, add an explicit nudge to bust any deterministic satisficing path.
    const userMessage = attempt === 0
      ? baseMessage
      : baseMessage + `\n\nAim for thorough coverage — find ALL synonym/paraphrase groups in this list. Most groups have at least 15–30 clusters; do not stop after 1 or 2.`
    try {
      const message = await loggedCreate(client, supabase, {
        model: MODEL,
        max_tokens: 16000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: userMessage }],
      }, { operation: "tag_cluster_propose", workloadType: "admin", metadata: { attempt } })
      console.log(`  attempt ${attempt + 1}: stop_reason=${message.stop_reason} tokens=${message.usage.input_tokens}/${message.usage.output_tokens}`)
      const toolUse = message.content.find((b) => b.type === "tool_use")
      if (!toolUse) {
        console.error("  content blocks:", JSON.stringify(message.content.map((b) => b.type)))
        throw new Error("model returned no tool_use block")
      }
      const payload = toolUse.input
      if (!payload || !Array.isArray(payload.clusters)) {
        console.error("  tool_use.input was:", JSON.stringify(payload).slice(0, 500))
        throw new Error(`invalid tool payload shape (stop_reason=${message.stop_reason})`)
      }
      // Sonnet 4-6 sometimes satisfices with just 1 cluster on first try when
      // tool_choice is forced. If the result is suspiciously sparse, retry.
      if (attempt === 0 && payload.clusters.length < 5 && sorted.length > 50) {
        console.log(`  too few clusters (${payload.clusters.length}); retrying...`)
        lastError = new Error(`suspiciously few clusters: ${payload.clusters.length}`)
        continue
      }
      return {
        clusters: payload.clusters,
        usage: message.usage,
      }
    } catch (err) {
      lastError = err
      if (attempt === 1) break
    }
  }
  throw new Error(`Claude call failed: ${lastError && lastError.message ? lastError.message : String(lastError)}`)
}

async function processGroup(groupSlug) {
  console.log(`[propose-tag-clusters] group=${groupSlug} min_confidence=${MIN_CONFIDENCE}`)
  console.log(`[propose-tag-clusters] fetching tags...`)
  const { tags } = await fetchTagsInGroup(groupSlug)
  console.log(`[propose-tag-clusters] ${tags.length} tags in group "${groupSlug}".`)

  if (tags.length < 2) {
    console.log(`[propose-tag-clusters] nothing to cluster.`)
    return { tags: tags.length, proposals: 0, covered: 0, avgConf: 0, tokensIn: 0, tokensOut: 0, status: "skip" }
  }

  // Partition by sub-group: a cluster may only group tags from the SAME
  // sub-group. Tags without a sub-group (tag_subgroup_id null) form their own
  // bucket (covers groups that don't use sub-groups too).
  const buckets = new Map()
  for (const t of tags) {
    const key = t.tag_subgroup_id || "__none__"
    const arr = buckets.get(key) || []
    arr.push(t)
    buckets.set(key, arr)
  }
  console.log(`[propose-tag-clusters] ${buckets.size} sub-bucket(s); clustering each within its sub-group.`)

  // Build name→id lookup (case-insensitive) over the whole group.
  const nameToId = new Map()
  for (const t of tags) nameToId.set(t.name.toLowerCase(), t.id)

  const proposals = []
  const droppedForUnknownMember = 0
  let droppedForFewMembers = 0
  const seenMember = new Set()
  let tokensIn = 0
  let tokensOut = 0

  for (const [, bucket] of buckets) {
    if (bucket.length < 2) continue
    const bucketNames = new Set(bucket.map((t) => t.name.toLowerCase()))
    console.log(`[propose-tag-clusters] calling Claude (${MODEL}) for sub-bucket of ${bucket.length} tags...`)
    const { clusters: rawClusters, usage } = await callClaude(groupSlug, bucket.map((t) => t.name))
    tokensIn += usage.input_tokens
    tokensOut += usage.output_tokens
    const filtered = rawClusters.filter((c) => c.confidence >= MIN_CONFIDENCE)

    for (const cluster of filtered) {
      const memberIds = []
      const matched = []
      for (const memberName of cluster.members) {
        const key = memberName.toLowerCase()
        if (!bucketNames.has(key)) continue // member outside this sub-group — drop
        const id = nameToId.get(key)
        if (!id || seenMember.has(id)) continue
        memberIds.push(id)
        matched.push(memberName)
      }
      if (memberIds.length < 2) {
        droppedForFewMembers += 1
        continue
      }
      for (const id of memberIds) seenMember.add(id)

      const canonicalName = bucketNames.has(cluster.canonical_name.toLowerCase())
        ? cluster.canonical_name
        : matched[0]
      const canonicalSlug = slugifyTagName(canonicalName)
      if (!canonicalSlug) continue

      proposals.push({
        group_slug: groupSlug,
        canonical_name: canonicalName,
        canonical_slug: canonicalSlug,
        member_tag_ids: memberIds,
        confidence: cluster.confidence,
        rationale: cluster.rationale,
        status: "pending",
      })
    }
  }

  const usage = { input_tokens: tokensIn, output_tokens: tokensOut }

  console.log(`[propose-tag-clusters] valid proposals: ${proposals.length}`)
  if (droppedForUnknownMember) console.log(`  dropped (unknown member name): ${droppedForUnknownMember}`)
  if (droppedForFewMembers) console.log(`  dropped (<2 valid members): ${droppedForFewMembers}`)

  if (proposals.length === 0) {
    console.log(`[propose-tag-clusters] nothing to insert.`)
    return {
      tags: tags.length, proposals: 0, covered: 0, avgConf: 0,
      tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, status: "ok",
    }
  }

  // Wipe prior pending proposals for this group.
  const { error: delErr } = await supabase
    .from("tag_cluster_proposal")
    .delete()
    .eq("group_slug", groupSlug)
    .eq("status", "pending")
  if (delErr) throw delErr

  // Insert in chunks.
  const CHUNK = 100
  for (let i = 0; i < proposals.length; i += CHUNK) {
    const slice = proposals.slice(i, i + CHUNK)
    const { error } = await supabase.from("tag_cluster_proposal").insert(slice)
    if (error) throw error
  }

  const avgConf =
    proposals.reduce((s, p) => s + Number(p.confidence), 0) / proposals.length
  const totalMembers = proposals.reduce((s, p) => s + p.member_tag_ids.length, 0)
  console.log(`[propose-tag-clusters] DONE for "${groupSlug}".`)
  console.log(`  Inserted proposals: ${proposals.length}`)
  console.log(`  Tags covered:       ${totalMembers}`)
  console.log(`  Avg confidence:     ${avgConf.toFixed(2)}`)

  return {
    tags: tags.length,
    proposals: proposals.length,
    covered: totalMembers,
    avgConf,
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
  console.log(`[propose-tag-clusters] --all: ${slugs.length} groups to process`)
  console.log(`[propose-tag-clusters] groups: ${slugs.join(", ")}\n`)

  const summary = []
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    console.log(`\n[${i + 1}/${slugs.length}] ====== ${slug} ======`)
    try {
      const result = await processGroup(slug)
      summary.push({ group: slug, ...result })
    } catch (err) {
      console.error(`[propose-tag-clusters] FAILED group "${slug}":`, err && err.message ? err.message : err)
      summary.push({
        group: slug, tags: 0, proposals: 0, covered: 0, avgConf: 0,
        tokensIn: 0, tokensOut: 0, status: "fail",
      })
    }
  }

  // Final summary table.
  console.log(`\n\n========== SUMMARY ==========`)
  const totals = { tags: 0, proposals: 0, covered: 0, tokensIn: 0, tokensOut: 0 }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(
    `${pad("group", 28)} ${pad("tags", 6)} ${pad("props", 6)} ${pad("covered", 8)} ${pad("avg_conf", 9)} status`,
  )
  console.log("-".repeat(72))
  for (const row of summary) {
    totals.tags += row.tags
    totals.proposals += row.proposals
    totals.covered += row.covered
    totals.tokensIn += row.tokensIn
    totals.tokensOut += row.tokensOut
    const conf = row.avgConf ? row.avgConf.toFixed(2) : "-"
    console.log(
      `${pad(row.group, 28)} ${pad(row.tags, 6)} ${pad(row.proposals, 6)} ${pad(row.covered, 8)} ${pad(conf, 9)} ${row.status}`,
    )
  }
  console.log("-".repeat(72))
  console.log(
    `${pad("TOTAL", 28)} ${pad(totals.tags, 6)} ${pad(totals.proposals, 6)} ${pad(totals.covered, 8)} ${pad("-", 9)}`,
  )
  console.log(`Tokens: in=${totals.tokensIn} out=${totals.tokensOut}`)
}

main().catch((err) => {
  console.error(`[propose-tag-clusters] FAILED`, err)
  process.exit(1)
})
