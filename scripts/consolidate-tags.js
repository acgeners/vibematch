// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Tag consolidation script — Phase 1: format dedup.
 *
 * Goal: collapse format duplicates in `tags` (snake_case vs kebab-case),
 * redirect `work_tags` rows to the canonical tag, and record alias mappings
 * in `tag_alias` so future ingestion of legacy slugs still resolves correctly.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/consolidate-tags.js --dry-run
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/consolidate-tags.js
 *
 * Prerequisites: migration 040_tag_alias.sql applied.
 *
 * Idempotent: safe to re-run. On second run, no clusters will need merging.
 */

const { createClient } = require("@supabase/supabase-js")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://obwlwukwovetgjqdpizd.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required.")
  process.exit(1)
}

const DRY_RUN = process.argv.includes("--dry-run")
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v")

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Kebab-case canonical slug. Mirrors lib/utils.ts#slugifyTagName. */
function canonicalize(slug) {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function log(...args) {
  console.log(...args)
}
function vlog(...args) {
  if (VERBOSE) console.log(...args)
}

async function fetchAllTags() {
  const PAGE = 1000
  const all = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, slug, name, tag_group_id, created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function fetchWorkTagCounts(tagIds) {
  // Batch in chunks of 500 to keep the URL/length manageable.
  const counts = new Map()
  for (const id of tagIds) counts.set(id, 0)
  const CHUNK = 100
  for (let i = 0; i < tagIds.length; i += CHUNK) {
    const chunk = tagIds.slice(i, i + CHUNK)
    // Use the `count: "exact"` head fetch per tag_id is too chatty.
    // Instead, fetch work_tags rows for the chunk and count client-side.
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from("work_tags")
        .select("tag_id")
        .in("tag_id", chunk)
        .range(offset, offset + 999)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const row of data) {
        counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
      }
      if (data.length < 1000) break
      offset += 1000
    }
  }
  return counts
}

function electCanonical(tags, counts) {
  // 1) Most work_tags refs win. 2) Kebab-format slug wins on tie. 3) Oldest wins.
  return tags
    .map((t) => ({
      tag: t,
      refs: counts.get(t.id) ?? 0,
      kebab: !t.slug.includes("_"),
      ts: new Date(t.created_at).getTime(),
    }))
    .sort((a, b) => {
      if (b.refs !== a.refs) return b.refs - a.refs
      if (a.kebab !== b.kebab) return a.kebab ? -1 : 1
      return a.ts - b.ts
    })[0].tag
}

async function redirectWorkTags(fromId, toId) {
  // Delete (work_id, fromId) rows that already have (work_id, toId) — avoids
  // unique-constraint conflict on update.
  // Step A: find which work_ids already have the canonical tag.
  const existingForCanonical = new Set()
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from("work_tags")
      .select("work_id")
      .eq("tag_id", toId)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) existingForCanonical.add(row.work_id)
    if (data.length < 1000) break
    offset += 1000
  }

  // Step B: for fromId rows whose work_id is already in canonical, delete fromId row.
  // For the rest, update to toId.
  offset = 0
  const updates = []
  const deletes = []
  while (true) {
    const { data, error } = await supabase
      .from("work_tags")
      .select("work_id")
      .eq("tag_id", fromId)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      if (existingForCanonical.has(row.work_id)) deletes.push(row.work_id)
      else updates.push(row.work_id)
    }
    if (data.length < 1000) break
    offset += 1000
  }

  let redirected = 0
  if (deletes.length > 0) {
    // Bulk delete (work_id IN deletes AND tag_id = fromId)
    const CHUNK = 100
    for (let i = 0; i < deletes.length; i += CHUNK) {
      const slice = deletes.slice(i, i + CHUNK)
      const { error } = await supabase
        .from("work_tags")
        .delete()
        .eq("tag_id", fromId)
        .in("work_id", slice)
      if (error) throw error
    }
  }
  if (updates.length > 0) {
    const CHUNK = 100
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK)
      const { error } = await supabase
        .from("work_tags")
        .update({ tag_id: toId })
        .eq("tag_id", fromId)
        .in("work_id", slice)
      if (error) throw error
      redirected += slice.length
    }
  }
  return { redirected, deletedDuplicates: deletes.length }
}

async function upsertAlias(aliasSlug, canonicalTagId) {
  const { error } = await supabase
    .from("tag_alias")
    .upsert({ alias_slug: aliasSlug, canonical_tag_id: canonicalTagId }, { onConflict: "alias_slug" })
  if (error) throw error
}

async function renameTagSlug(tagId, newSlug) {
  const { error } = await supabase
    .from("tags")
    .update({ slug: newSlug })
    .eq("id", tagId)
  if (error) throw error
}

async function deleteTag(tagId) {
  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", tagId)
  if (error) throw error
}

async function main() {
  log(`[consolidate-tags] mode: ${DRY_RUN ? "DRY-RUN" : "EXECUTE"}`)
  log(`[consolidate-tags] fetching tags...`)
  const tags = await fetchAllTags()
  log(`[consolidate-tags] ${tags.length} tags fetched.`)

  // Group by canonical kebab-case slug.
  const clusters = new Map()
  for (const t of tags) {
    const canonical = canonicalize(t.slug)
    if (!canonical) continue
    if (!clusters.has(canonical)) clusters.set(canonical, [])
    clusters.get(canonical).push(t)
  }

  const multi = [...clusters.entries()].filter(([, members]) => members.length > 1)
  const singletonNonKebab = [...clusters.entries()].filter(
    ([canonical, members]) => members.length === 1 && members[0].slug !== canonical,
  )
  log(`[consolidate-tags] ${multi.length} multi-tag clusters, ${singletonNonKebab.length} singletons needing rename.`)

  // Fetch reference counts in one pass for all involved tag ids.
  const involvedIds = []
  for (const [, members] of multi) for (const m of members) involvedIds.push(m.id)
  log(`[consolidate-tags] counting work_tags refs for ${involvedIds.length} tag ids...`)
  const refCounts = involvedIds.length > 0 ? await fetchWorkTagCounts(involvedIds) : new Map()

  let mergedClusters = 0
  let aliasesCreated = 0
  let workTagsRedirected = 0
  let workTagsDeletedDup = 0
  let slugsRenamed = 0
  let tagsDeleted = 0

  // Process multi-clusters.
  for (const [canonicalSlug, members] of multi) {
    const canonicalTag = electCanonical(members, refCounts)
    const losers = members.filter((m) => m.id !== canonicalTag.id)
    vlog(
      `  cluster "${canonicalSlug}": canonical=${canonicalTag.slug} (refs=${refCounts.get(canonicalTag.id) ?? 0}), losers=${losers.map((l) => l.slug).join(",")}`,
    )
    for (const loser of losers) {
      if (!DRY_RUN) {
        const { redirected, deletedDuplicates } = await redirectWorkTags(loser.id, canonicalTag.id)
        workTagsRedirected += redirected
        workTagsDeletedDup += deletedDuplicates
        await upsertAlias(loser.slug, canonicalTag.id)
        await deleteTag(loser.id)
      } else {
        const refs = refCounts.get(loser.id) ?? 0
        workTagsRedirected += refs // approximate (no dedup awareness in dry-run)
      }
      aliasesCreated += 1
      tagsDeleted += 1
    }
    // If the elected canonical slug itself is non-kebab, rename it.
    if (canonicalTag.slug !== canonicalSlug) {
      if (!DRY_RUN) {
        const oldSlug = canonicalTag.slug
        await renameTagSlug(canonicalTag.id, canonicalSlug)
        await upsertAlias(oldSlug, canonicalTag.id)
      }
      slugsRenamed += 1
      aliasesCreated += 1
    }
    mergedClusters += 1
  }

  // Singletons with non-kebab slug — just rename + alias.
  for (const [canonicalSlug, members] of singletonNonKebab) {
    const t = members[0]
    vlog(`  rename: ${t.slug} → ${canonicalSlug}`)
    if (!DRY_RUN) {
      await renameTagSlug(t.id, canonicalSlug)
      await upsertAlias(t.slug, t.id)
    }
    slugsRenamed += 1
    aliasesCreated += 1
  }

  log(`[consolidate-tags] DONE.`)
  log(`  Clusters merged:        ${mergedClusters}`)
  log(`  Slugs renamed:          ${slugsRenamed}`)
  log(`  Aliases created:        ${aliasesCreated}`)
  log(`  Tags deleted:           ${tagsDeleted}`)
  log(`  work_tags redirected:   ${workTagsRedirected}`)
  log(`  work_tags dup removed:  ${workTagsDeletedDup}`)
  if (DRY_RUN) {
    log(`\n  (dry-run — nothing was written. Re-run without --dry-run to apply.)`)
  }
}

main().catch((err) => {
  console.error(`[consolidate-tags] FAILED`, err)
  process.exit(1)
})
