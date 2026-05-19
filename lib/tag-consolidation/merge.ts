// Shared destructive logic for merging tags into a canonical tag.
// Used by Phase 2 (`server/actions/tag-consolidation.ts` → `applyApprovedProposals`).
// Phase 1 (`scripts/consolidate-tags.js`) has its own JS implementation since
// it pre-dates this helper; both follow the same algorithm.

import { createAdminClient } from "@/lib/supabase/admin"
import { slugifyTagName } from "@/lib/utils"

const SUPABASE_IN_CHUNK = 100 // PostgREST header limit guard

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export interface MergeArgs {
  canonicalName: string
  canonicalSlug: string
  tagGroupId: string | null
  memberTagIds: string[]
}

export interface MergeResult {
  canonicalTagId: string
  removedTagIds: string[]
  workTagsRedirected: number
  workTagsDuplicatesRemoved: number
  aliasesCreated: number
}

export async function mergeIntoCanonical(
  supabase: SupabaseAdmin,
  args: MergeArgs,
): Promise<MergeResult> {
  const canonicalSlug = slugifyTagName(args.canonicalSlug || args.canonicalName)
  if (!canonicalSlug) throw new Error("canonical_slug resolves to empty after slugify")

  // 1. Pick or create the canonical tag.
  // Prefer a member that already has the canonical_slug so we keep its id+history.
  const { data: members, error: membersErr } = await supabase
    .from("tags")
    .select("id, slug, name, tag_group_id")
    .in("id", args.memberTagIds)
  if (membersErr) throw membersErr
  if (!members || members.length === 0) throw new Error("no member tags found")

  let canonical = members.find((m) => m.slug === canonicalSlug)

  if (!canonical) {
    // No member has the canonical slug. Try to find an existing tag elsewhere with that slug.
    const { data: existing } = await supabase
      .from("tags")
      .select("id, slug, name, tag_group_id")
      .eq("slug", canonicalSlug)
      .limit(1)
    if (existing && existing.length > 0) {
      canonical = existing[0]
    } else {
      // Create a new canonical tag.
      const { data: inserted, error: insertErr } = await supabase
        .from("tags")
        .insert({
          slug: canonicalSlug,
          name: args.canonicalName,
          tag_group_id: args.tagGroupId,
        })
        .select("id, slug, name, tag_group_id")
        .single()
      if (insertErr) throw insertErr
      canonical = inserted
    }
  } else {
    // Update the name if the user-approved label differs.
    if (canonical.name !== args.canonicalName) {
      await supabase
        .from("tags")
        .update({ name: args.canonicalName })
        .eq("id", canonical.id)
    }
  }

  const canonicalId = canonical.id as string
  const losers = members.filter((m) => m.id !== canonicalId)

  let workTagsRedirected = 0
  let workTagsDuplicatesRemoved = 0
  let aliasesCreated = 0
  const removedTagIds: string[] = []

  for (const loser of losers) {
    const result = await redirectWorkTags(supabase, loser.id as string, canonicalId)
    workTagsRedirected += result.redirected
    workTagsDuplicatesRemoved += result.deletedDuplicates

    const { error: aliasErr } = await supabase
      .from("tag_alias")
      .upsert(
        { alias_slug: loser.slug, canonical_tag_id: canonicalId },
        { onConflict: "alias_slug" },
      )
    if (aliasErr) throw aliasErr
    aliasesCreated += 1

    const { error: delErr } = await supabase.from("tags").delete().eq("id", loser.id)
    if (delErr) throw delErr
    removedTagIds.push(loser.id as string)
  }

  // If the canonical didn't start with the kebab slug (e.g. we inserted a new
  // tag instead), ensure the original slugs of losers are aliased — already
  // done above. If we picked a member as canonical and its slug happened to
  // not equal canonicalSlug, rename + alias the old.
  if (canonical.slug !== canonicalSlug) {
    const oldSlug = canonical.slug
    await supabase.from("tags").update({ slug: canonicalSlug }).eq("id", canonicalId)
    await supabase
      .from("tag_alias")
      .upsert(
        { alias_slug: oldSlug, canonical_tag_id: canonicalId },
        { onConflict: "alias_slug" },
      )
    aliasesCreated += 1
  }

  return {
    canonicalTagId: canonicalId,
    removedTagIds,
    workTagsRedirected,
    workTagsDuplicatesRemoved,
    aliasesCreated,
  }
}

async function redirectWorkTags(
  supabase: SupabaseAdmin,
  fromId: string,
  toId: string,
): Promise<{ redirected: number; deletedDuplicates: number }> {
  // Determine which work_ids already have the canonical tag (would conflict).
  const existingForCanonical = new Set<string>()
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from("work_tags")
      .select("work_id")
      .eq("tag_id", toId)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) existingForCanonical.add(row.work_id as string)
    if (data.length < 1000) break
    offset += 1000
  }

  // Split fromId rows into "duplicate" (delete) and "redirect" (update).
  const updates: string[] = []
  const deletes: string[] = []
  offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from("work_tags")
      .select("work_id")
      .eq("tag_id", fromId)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      if (existingForCanonical.has(row.work_id as string)) deletes.push(row.work_id as string)
      else updates.push(row.work_id as string)
    }
    if (data.length < 1000) break
    offset += 1000
  }

  let redirected = 0
  if (deletes.length > 0) {
    for (let i = 0; i < deletes.length; i += SUPABASE_IN_CHUNK) {
      const slice = deletes.slice(i, i + SUPABASE_IN_CHUNK)
      const { error } = await supabase
        .from("work_tags")
        .delete()
        .eq("tag_id", fromId)
        .in("work_id", slice)
      if (error) throw error
    }
  }
  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += SUPABASE_IN_CHUNK) {
      const slice = updates.slice(i, i + SUPABASE_IN_CHUNK)
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
