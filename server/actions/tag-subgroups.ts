"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { slugifyTagName } from "@/lib/utils"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
import { moveTagToGroup } from "@/server/actions/tag-consolidation"
import { ensureAdmin } from "@/server/queries/current-user"

const PATH = "/settings/tag-consolidation"

export type SubgroupStatus = "pending" | "approved" | "rejected"
export type AssignmentStatus = "pending" | "approved" | "rejected" | "applied"

export interface Subgroup {
  id: string
  tag_group_id: string
  group_slug: string
  name: string
  slug: string
  description: string | null
  rationale: string | null
  confidence: number | null
  sort_order: number
  status: SubgroupStatus
  reviewed_at: string | null
  created_at: string
}

export interface AssignmentTag {
  assignmentId: string
  tagId: string
  name: string
  slug: string
  status: AssignmentStatus
  confidence: number | null
}

export interface SubgroupWithTags extends Subgroup {
  tags: AssignmentTag[]
}

export interface UnassignedTag {
  id: string
  name: string
  slug: string
}

// ============================================================
// Phase 1 — sub-group definitions
// ============================================================

export async function listSubgroups(
  groupSlug?: string,
  status?: SubgroupStatus,
): Promise<Subgroup[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("tag_subgroup")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  if (groupSlug) query = query.eq("group_slug", groupSlug)
  if (status) query = query.eq("status", status)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as Subgroup[]
}

export async function approveSubgroup(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function rejectSubgroup(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function reopenSubgroup(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup")
    .update({ status: "pending", reviewed_at: null })
    .eq("id", id)
    .in("status", ["approved", "rejected"])
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function editSubgroup(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { error: "Nome não pode ser vazio" }
    update.name = name
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() || null
  }
  if (Object.keys(update).length === 0) return {}
  const supabase = createAdminClient()
  const { error } = await supabase.from("tag_subgroup").update(update).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

// Manual creation — created directly as "approved" so it can immediately
// receive tags in Phase 2.
export async function createSubgroup(input: {
  group_slug: string
  name: string
  description?: string | null
}): Promise<{ error?: string; id?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const name = input.name.trim()
  if (!name) return { error: "Nome é obrigatório" }
  const tagGroupId = (TAG_GROUP_IDS as Record<string, string>)[input.group_slug]
  if (!tagGroupId) return { error: `Grupo "${input.group_slug}" inválido` }
  const slug = slugifyTagName(name)
  if (!slug) return { error: "Nome inválido (slug vazio)" }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tag_subgroup")
    .insert({
      tag_group_id: tagGroupId,
      group_slug: input.group_slug,
      name,
      slug,
      description: input.description?.trim() || null,
      status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") return { error: "Já existe um sub-grupo com esse nome no grupo" }
    return { error: error.message }
  }
  revalidatePath(PATH)
  return { id: data.id as string }
}

export async function deleteSubgroup(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  // FK ON DELETE CASCADE drops pending assignments; ON DELETE SET NULL on
  // tags.tag_subgroup_id clears any applied assignment for the bucket.
  const { error } = await supabase.from("tag_subgroup").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function bulkSetSubgroupStatus(
  ids: string[],
  status: SubgroupStatus,
): Promise<{ updated: number; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { updated: 0, error: gate.error }
  if (ids.length === 0) return { updated: 0 }
  const supabase = createAdminClient()
  const fromStatuses: SubgroupStatus[] =
    status === "approved"
      ? ["pending"]
      : status === "rejected"
        ? ["pending", "approved"]
        : ["approved", "rejected"]
  const patch =
    status === "pending"
      ? { status, reviewed_at: null }
      : { status, reviewed_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from("tag_subgroup")
    .update(patch)
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath(PATH)
  return { updated: data?.length ?? 0 }
}

// ============================================================
// Phase 2 — tag → sub-group assignments
// ============================================================

// Returns approved sub-groups for the group, each hydrated with the tags
// currently assigned to it (any assignment status).
export async function listSubgroupAssignments(groupSlug: string): Promise<SubgroupWithTags[]> {
  const supabase = createAdminClient()
  const [subsRes, asgRes] = await Promise.all([
    supabase
      .from("tag_subgroup")
      .select("*")
      .eq("group_slug", groupSlug)
      .eq("status", "approved")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("tag_subgroup_assignment")
      .select("id, tag_id, subgroup_id, status, confidence")
      .eq("group_slug", groupSlug)
      .neq("status", "rejected"),
  ])
  if (subsRes.error) throw new Error(subsRes.error.message)
  if (asgRes.error) throw new Error(asgRes.error.message)

  const subs = (subsRes.data ?? []) as Subgroup[]
  const assignments = asgRes.data ?? []

  // Hydrate tag names.
  const tagIds = [...new Set(assignments.map((a) => a.tag_id as string))]
  const byTagId = new Map<string, { name: string; slug: string }>()
  const CHUNK = 100
  for (let i = 0; i < tagIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, name, slug")
      .in("id", tagIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const t of data ?? []) byTagId.set(t.id as string, { name: t.name as string, slug: t.slug as string })
  }

  const bySubgroup = new Map<string, AssignmentTag[]>()
  for (const a of assignments) {
    const tag = byTagId.get(a.tag_id as string)
    if (!tag) continue // tag deleted; skip
    const list = bySubgroup.get(a.subgroup_id as string) ?? []
    list.push({
      assignmentId: a.id as string,
      tagId: a.tag_id as string,
      name: tag.name,
      slug: tag.slug,
      status: a.status as AssignmentStatus,
      confidence: (a.confidence as number | null) ?? null,
    })
    bySubgroup.set(a.subgroup_id as string, list)
  }

  return subs.map((s) => ({
    ...s,
    tags: (bySubgroup.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

// Tags in the group that have no active (pending/approved/applied) assignment.
export async function listUnassignedTags(groupSlug: string): Promise<UnassignedTag[]> {
  const groupId = (TAG_GROUP_IDS as Record<string, string>)[groupSlug]
  if (!groupId) return []
  const supabase = createAdminClient()
  const [tagsRes, asgRes] = await Promise.all([
    supabase.from("tags").select("id, name, slug").eq("tag_group_id", groupId).order("name"),
    supabase
      .from("tag_subgroup_assignment")
      .select("tag_id")
      .eq("group_slug", groupSlug)
      .neq("status", "rejected"),
  ])
  if (tagsRes.error) throw new Error(tagsRes.error.message)
  if (asgRes.error) throw new Error(asgRes.error.message)
  const assigned = new Set((asgRes.data ?? []).map((a) => a.tag_id as string))
  return ((tagsRes.data ?? []) as UnassignedTag[]).filter((t) => !assigned.has(t.id))
}

// Move/assign a tag to a sub-group. A manual placement counts as approval,
// so the row is upserted as "approved" (one assignment per tag).
export async function moveTagToSubgroup(
  tagId: string,
  subgroupId: string,
  groupSlug: string,
): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup_assignment")
    .upsert(
      {
        tag_id: tagId,
        subgroup_id: subgroupId,
        group_slug: groupSlug,
        status: "approved",
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "tag_id" },
    )
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

// Remove a tag from its sub-group entirely (deletes the assignment row and
// clears the applied link on the tag).
export async function unassignTag(tagId: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const [delRes, tagRes] = await Promise.all([
    supabase.from("tag_subgroup_assignment").delete().eq("tag_id", tagId),
    supabase.from("tags").update({ tag_subgroup_id: null }).eq("id", tagId),
  ])
  if (delRes.error) return { error: delRes.error.message }
  if (tagRes.error) return { error: tagRes.error.message }
  revalidatePath(PATH)
  return {}
}

// Move a tag to a different tag_group entirely. The tag leaves its current
// group, so its sub-group assignment + applied link are cleared first; the
// actual group change (and any cluster-proposal cleanup) is delegated to
// moveTagToGroup.
export async function moveTagToOtherGroup(
  tagId: string,
  targetGroupSlug: string,
): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error: delErr } = await supabase
    .from("tag_subgroup_assignment")
    .delete()
    .eq("tag_id", tagId)
  if (delErr) return { error: delErr.message }
  const { error: clearErr } = await supabase
    .from("tags")
    .update({ tag_subgroup_id: null })
    .eq("id", tagId)
  if (clearErr) return { error: clearErr.message }
  const result = await moveTagToGroup(tagId, targetGroupSlug)
  if (result.error) return { error: result.error }
  revalidatePath(PATH)
  return {}
}

// Bulk version of moveTagToSubgroup — reassigns many tags to one sub-group at
// once (single upsert). Each placement counts as approval.
export async function moveTagsToSubgroup(
  tagIds: string[],
  subgroupId: string,
  groupSlug: string,
): Promise<{ moved: number; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { moved: 0, error: gate.error }
  if (tagIds.length === 0) return { moved: 0 }
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  const rows = tagIds.map((tagId) => ({
    tag_id: tagId,
    subgroup_id: subgroupId,
    group_slug: groupSlug,
    status: "approved" as const,
    reviewed_at: now,
  }))
  const { error } = await supabase
    .from("tag_subgroup_assignment")
    .upsert(rows, { onConflict: "tag_id" })
  if (error) return { moved: 0, error: error.message }
  revalidatePath(PATH)
  return { moved: tagIds.length }
}

// Bulk version of moveTagToOtherGroup — loops the per-tag move (which also
// clears sub-group state and cleans cluster proposals) so behaviour matches
// the single-tag path exactly. Stops and reports on the first error.
export async function moveTagsToOtherGroup(
  tagIds: string[],
  targetGroupSlug: string,
): Promise<{ moved: number; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { moved: 0, error: gate.error }
  let moved = 0
  for (const id of tagIds) {
    const { error } = await moveTagToOtherGroup(id, targetGroupSlug)
    if (error) return { moved, error }
    moved += 1
  }
  revalidatePath(PATH)
  return { moved }
}

export async function approveAssignment(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup_assignment")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function rejectAssignment(id: string): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_subgroup_assignment")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function bulkSetAssignmentStatus(
  ids: string[],
  status: "approved" | "rejected" | "pending",
): Promise<{ updated: number; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { updated: 0, error: gate.error }
  if (ids.length === 0) return { updated: 0 }
  const supabase = createAdminClient()
  const fromStatuses =
    status === "approved"
      ? ["pending"]
      : status === "rejected"
        ? ["pending", "approved"]
        : ["approved", "rejected"]
  const patch =
    status === "pending"
      ? { status, reviewed_at: null }
      : { status, reviewed_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from("tag_subgroup_assignment")
    .update(patch)
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath(PATH)
  return { updated: data?.length ?? 0 }
}

export interface ApplyAssignmentsResult {
  applied: number
  failed: number
  errors: string[]
}

// Writes tags.tag_subgroup_id for every approved assignment, then marks the
// assignment "applied". Non-destructive and reversible (unassignTag / re-apply).
export async function applyApprovedAssignments(
  groupSlug?: string,
): Promise<ApplyAssignmentsResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { applied: 0, failed: 0, errors: [gate.error] }
  const supabase = createAdminClient()
  let query = supabase
    .from("tag_subgroup_assignment")
    .select("id, tag_id, subgroup_id")
    .eq("status", "approved")
  if (groupSlug) query = query.eq("group_slug", groupSlug)
  const { data: approved, error } = await query
  if (error) throw new Error(error.message)

  const result: ApplyAssignmentsResult = { applied: 0, failed: 0, errors: [] }
  for (const a of approved ?? []) {
    const { error: tagErr } = await supabase
      .from("tags")
      .update({ tag_subgroup_id: a.subgroup_id })
      .eq("id", a.tag_id)
    if (tagErr) {
      result.failed += 1
      result.errors.push(`${a.tag_id}: ${tagErr.message}`)
      continue
    }
    const { error: asgErr } = await supabase
      .from("tag_subgroup_assignment")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", a.id)
    if (asgErr) {
      result.failed += 1
      result.errors.push(`${a.tag_id}: ${asgErr.message}`)
      continue
    }
    result.applied += 1
  }
  revalidatePath(PATH)
  return result
}
