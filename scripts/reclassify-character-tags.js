// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Reclassify tags currently in the `characters` group into one of:
 *   - male_lead    (tags clearly about the male protagonist)
 *   - female_lead  (tags clearly about the female protagonist)
 *   - characters   (generic protagonist / supporting cast / archetypes
 *                    that apply to either gender)
 *
 * Run AFTER applying migration 042 (which creates the new groups).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/reclassify-character-tags.js [--dry-run]
 */

const { createClient } = require("@supabase/supabase-js")
const Anthropic = require("@anthropic-ai/sdk").default
const { loggedCreate } = require("./lib/ai-log.js")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://obwlwukwovetgjqdpizd.supabase.co"
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

const DRY_RUN = process.argv.includes("--dry-run")
const MODEL = "claude-sonnet-4-6"

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SYSTEM_PROMPT = `You receive an alphabetically-sorted list of tag names. Each tag currently belongs to a generic "characters" group. Your task is to re-classify each tag into exactly ONE of three buckets:

- "male_lead": the tag describes a trait, role, personality, archetype, or backstory SPECIFICALLY about the male protagonist / male lead / ML / male MC. Examples: "cold-male-lead", "possessive-ml", "abused-male-protagonist", "tsundere-male-lead", "demon-king-mc-male".
- "female_lead": the tag describes a trait, role, personality, archetype, or backstory SPECIFICALLY about the female protagonist / female lead / FL / female MC / heroine. Examples: "abused-female-lead", "cold-fl", "reincarnated-heroine", "naive-female-mc".
- "characters": everything else — generic protagonist tags (no gender specified), supporting-cast tags, archetypes that apply to either gender, side characters, etc. Examples: "naive-protagonist" (no gender), "assassin", "demon-king" (not specified as MC), "abandoned-child", "side-character", "twins".

Rules:
1. Every input tag must appear exactly once in the output classifications array.
2. When uncertain (e.g. "abused-protagonist" — could be either), default to "characters" unless the tag name explicitly contains gender markers (female/male/FL/ML/heroine/hero — but "hero" alone is ambiguous; "male-hero" or "male-protagonist" is clear).
3. Respond ONLY via the \`classify_tags\` tool.
`

const TOOL = {
  name: "classify_tags",
  description: "Returns the bucket for each input tag. Always use this tool to respond.",
  input_schema: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The tag name, exactly as given in the input." },
            bucket: {
              type: "string",
              enum: ["male_lead", "female_lead", "characters"],
            },
          },
          required: ["name", "bucket"],
        },
      },
    },
    required: ["classifications"],
  },
}

async function fetchGroup(slug) {
  const { data, error } = await supabase
    .from("tag_group")
    .select("id, slug")
    .eq("slug", slug)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`tag_group "${slug}" not found`)
  return data[0]
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

async function callClaudeForChunk(client, tagNames) {
  const userMessage =
    `Total tags: ${tagNames.length}\n\n` +
    `Tag names (one per line):\n` +
    tagNames.slice().sort((a, b) => a.localeCompare(b)).join("\n")

  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await loggedCreate(client, supabase, {
        model: MODEL,
        max_tokens: 12000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: userMessage }],
      }, { operation: "tag_reclassify", workloadType: "admin", metadata: { attempt } })
      console.log(`    stop_reason=${message.stop_reason} tokens=${message.usage.input_tokens}/${message.usage.output_tokens}`)
      const toolUse = message.content.find((b) => b.type === "tool_use")
      if (!toolUse) throw new Error("model returned no tool_use block")
      const payload = toolUse.input
      if (!payload || !Array.isArray(payload.classifications)) {
        throw new Error(`invalid tool payload shape (stop_reason=${message.stop_reason})`)
      }
      return { classifications: payload.classifications, usage: message.usage }
    } catch (err) {
      lastError = err
      if (attempt === 1) break
    }
  }
  throw new Error(`Claude call failed: ${lastError && lastError.message ? lastError.message : String(lastError)}`)
}

async function callClaude(tagNames) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  // Chunk to keep each call comfortably under the 10-minute streaming threshold.
  const CHUNK_SIZE = 200
  const chunks = []
  for (let i = 0; i < tagNames.length; i += CHUNK_SIZE) {
    chunks.push(tagNames.slice(i, i + CHUNK_SIZE))
  }
  console.log(`  splitting into ${chunks.length} chunk(s) of up to ${CHUNK_SIZE} tags...`)

  const allClassifications = []
  let totalInput = 0
  let totalOutput = 0
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  chunk ${i + 1}/${chunks.length} (${chunks[i].length} tags):`)
    const { classifications, usage } = await callClaudeForChunk(client, chunks[i])
    allClassifications.push(...classifications)
    totalInput += usage.input_tokens
    totalOutput += usage.output_tokens
  }
  return {
    classifications: allClassifications,
    usage: { input_tokens: totalInput, output_tokens: totalOutput },
  }
}

async function main() {
  console.log(`[reclassify-character-tags] mode: ${DRY_RUN ? "DRY-RUN" : "EXECUTE"}`)

  const [charactersGroup, maleLeadGroup, femaleLeadGroup] = await Promise.all([
    fetchGroup("characters"),
    fetchGroup("male_lead"),
    fetchGroup("female_lead"),
  ])

  const tags = await fetchTagsInGroup(charactersGroup.id)
  console.log(`[reclassify-character-tags] ${tags.length} tags currently in characters group.`)
  if (tags.length === 0) {
    console.log(`[reclassify-character-tags] nothing to classify.`)
    return
  }

  console.log(`[reclassify-character-tags] calling Claude (${MODEL})...`)
  const { classifications, usage } = await callClaude(tags.map((t) => t.name))
  console.log(`[reclassify-character-tags] received ${classifications.length} classifications. tokens=${usage.input_tokens}/${usage.output_tokens}`)

  const byName = new Map()
  for (const t of tags) byName.set(t.name.toLowerCase(), t)

  const targetGroupBySlug = {
    male_lead: maleLeadGroup.id,
    female_lead: femaleLeadGroup.id,
    characters: charactersGroup.id,
  }

  const moves = { male_lead: [], female_lead: [], characters: [] }
  const unmatchedClassifications = []
  for (const c of classifications) {
    const tag = byName.get(String(c.name).toLowerCase())
    if (!tag) {
      unmatchedClassifications.push(c.name)
      continue
    }
    moves[c.bucket].push(tag)
  }

  const classifiedNames = new Set(classifications.map((c) => String(c.name).toLowerCase()))
  const unclassifiedTags = tags.filter((t) => !classifiedNames.has(t.name.toLowerCase()))

  console.log(`\n[reclassify-character-tags] classification results:`)
  console.log(`  male_lead:   ${moves.male_lead.length}`)
  console.log(`  female_lead: ${moves.female_lead.length}`)
  console.log(`  characters:  ${moves.characters.length}`)
  if (unmatchedClassifications.length > 0) {
    console.log(`  WARN: ${unmatchedClassifications.length} model classifications did not match any tag name:`)
    for (const name of unmatchedClassifications.slice(0, 10)) console.log(`    - ${name}`)
  }
  if (unclassifiedTags.length > 0) {
    console.log(`  WARN: ${unclassifiedTags.length} tags missing from classifications (defaulting to characters):`)
    for (const t of unclassifiedTags.slice(0, 10)) console.log(`    - ${t.name}`)
  }

  // Tags only need a DB update if they're moving to male_lead or female_lead
  // (characters stay put). Unclassified default to characters (no update).
  const toUpdate = [
    ...moves.male_lead.map((t) => ({ id: t.id, tag_group_id: targetGroupBySlug.male_lead })),
    ...moves.female_lead.map((t) => ({ id: t.id, tag_group_id: targetGroupBySlug.female_lead })),
  ]
  console.log(`\n[reclassify-character-tags] DB updates: ${toUpdate.length}`)

  if (DRY_RUN) {
    console.log(`  (dry-run — nothing written. Sample of moves:)`)
    for (const t of moves.male_lead.slice(0, 5)) console.log(`    male_lead   ← ${t.name}`)
    for (const t of moves.female_lead.slice(0, 5)) console.log(`    female_lead ← ${t.name}`)
    return
  }

  // Apply in chunks of 100. Supabase doesn't have a true bulk-update-by-id;
  // we issue individual updates but batch them with Promise.all.
  const CHUNK = 50
  let applied = 0
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const slice = toUpdate.slice(i, i + CHUNK)
    await Promise.all(
      slice.map((u) =>
        supabase.from("tags").update({ tag_group_id: u.tag_group_id }).eq("id", u.id),
      ),
    )
    applied += slice.length
    process.stdout.write(`\r  applied ${applied}/${toUpdate.length}`)
  }
  console.log("")
  console.log(`[reclassify-character-tags] DONE. ${applied} tags moved.`)
}

main().catch((err) => {
  console.error(`[reclassify-character-tags] FAILED`, err)
  process.exit(1)
})
