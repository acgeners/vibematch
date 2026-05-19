"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { mergeIntoCanonical } from "@/lib/tag-consolidation/merge"
import { slugifyTagName } from "@/lib/utils"
import { TAG_GROUP_IDS, type TagGroupSlug } from "@/lib/constants/tag-groups"

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied"

export interface TagClusterProposal {
  id: string
  group_slug: string
  canonical_name: string
  canonical_slug: string
  member_tag_ids: string[]
  confidence: number
  rationale: string | null
  status: ProposalStatus
  reviewed_at: string | null
  applied_at: string | null
  created_at: string
}

export interface ProposalWithMembers extends TagClusterProposal {
  members: Array<{ id: string; name: string; slug: string }>
}

export async function listProposals(
  groupSlug?: string,
  status?: ProposalStatus,
): Promise<ProposalWithMembers[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("tag_cluster_proposal")
    .select("*")
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
  if (groupSlug) query = query.eq("group_slug", groupSlug)
  if (status) query = query.eq("status", status)

  const { data: proposals, error } = await query
  if (error) throw new Error(error.message)
  if (!proposals || proposals.length === 0) return []

  // Hydrate members.
  const allIds = [...new Set(proposals.flatMap((p) => p.member_tag_ids as string[]))]
  if (allIds.length === 0) return proposals.map((p) => ({ ...(p as TagClusterProposal), members: [] }))

  const tagsByChunk: Array<{ id: string; name: string; slug: string }> = []
  const CHUNK = 100
  for (let i = 0; i < allIds.length; i += CHUNK) {
    const { data, error: tErr } = await supabase
      .from("tags")
      .select("id, name, slug")
      .in("id", allIds.slice(i, i + CHUNK))
    if (tErr) throw new Error(tErr.message)
    tagsByChunk.push(...((data ?? []) as Array<{ id: string; name: string; slug: string }>))
  }
  const byId = new Map(tagsByChunk.map((t) => [t.id, t]))

  return proposals.map((p) => ({
    ...(p as TagClusterProposal),
    members: (p.member_tag_ids as string[])
      .map((id) => byId.get(id))
      .filter((t): t is { id: string; name: string; slug: string } => Boolean(t)),
  }))
}

export async function approveProposal(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_cluster_proposal")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function bulkSetProposalStatus(
  ids: string[],
  status: "approved" | "rejected",
): Promise<{ updated: number; error?: string }> {
  if (ids.length === 0) return { updated: 0 }
  const supabase = createAdminClient()
  const fromStatuses = status === "approved" ? ["pending"] : ["pending", "approved"]
  const { data, error } = await supabase
    .from("tag_cluster_proposal")
    .update({ status, reviewed_at: new Date().toISOString() })
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return { updated: data?.length ?? 0 }
}

export async function rejectProposal(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_cluster_proposal")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function reopenProposal(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_cluster_proposal")
    .update({ status: "pending", reviewed_at: null })
    .eq("id", id)
    .in("status", ["approved", "rejected"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function editProposal(
  id: string,
  patch: { canonical_name?: string; member_tag_ids?: string[] },
): Promise<{ error?: string; autoRejected?: boolean }> {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (patch.canonical_name !== undefined) {
    updates.canonical_name = patch.canonical_name
    updates.canonical_slug = slugifyTagName(patch.canonical_name)
  }
  if (patch.member_tag_ids !== undefined) {
    // <2 members means the cluster is no longer meaningful — auto-reject.
    if (patch.member_tag_ids.length < 2) {
      const { error } = await supabase
        .from("tag_cluster_proposal")
        .update({
          ...updates,
          member_tag_ids: patch.member_tag_ids,
          status: "rejected",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .in("status", ["pending", "approved"])
      if (error) return { error: error.message }
      revalidatePath("/settings/tag-consolidation")
      return { autoRejected: true }
    }
    updates.member_tag_ids = patch.member_tag_ids
  }
  if (Object.keys(updates).length === 0) return {}

  const { error } = await supabase
    .from("tag_cluster_proposal")
    .update(updates)
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export interface ApplyResult {
  applied: number
  failed: number
  errors: string[]
  tagsRemoved: number
  workTagsRedirected: number
}

export async function applyApprovedProposals(groupSlug?: string): Promise<ApplyResult> {
  const supabase = createAdminClient()
  let query = supabase
    .from("tag_cluster_proposal")
    .select("*")
    .eq("status", "approved")
  if (groupSlug) query = query.eq("group_slug", groupSlug)

  const { data: approved, error } = await query
  if (error) return { applied: 0, failed: 0, errors: [error.message], tagsRemoved: 0, workTagsRedirected: 0 }
  if (!approved || approved.length === 0) {
    return { applied: 0, failed: 0, errors: [], tagsRemoved: 0, workTagsRedirected: 0 }
  }

  const result: ApplyResult = {
    applied: 0,
    failed: 0,
    errors: [],
    tagsRemoved: 0,
    workTagsRedirected: 0,
  }

  for (const proposal of approved) {
    const p = proposal as TagClusterProposal
    const groupId = (TAG_GROUP_IDS as Record<string, string>)[p.group_slug] ?? null
    try {
      const merge = await mergeIntoCanonical(supabase, {
        canonicalName: p.canonical_name,
        canonicalSlug: p.canonical_slug,
        tagGroupId: groupId,
        memberTagIds: p.member_tag_ids,
      })
      await supabase
        .from("tag_cluster_proposal")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("id", p.id)
      result.applied += 1
      result.tagsRemoved += merge.removedTagIds.length
      result.workTagsRedirected += merge.workTagsRedirected
    } catch (err) {
      result.failed += 1
      result.errors.push(`${p.canonical_name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  revalidatePath("/settings/tag-consolidation")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  return result
}

export async function listGroupSlugs(): Promise<TagGroupSlug[]> {
  return Object.keys(TAG_GROUP_IDS) as TagGroupSlug[]
}

export interface UncoveredTag {
  id: string
  name: string
  slug: string
}

// Returns tags in the given group that are NOT members of any proposal
// (pending/approved/applied/rejected). Useful so the user can move them
// to another group from the consolidation page even when they didn't
// end up in any AI-proposed cluster.
export async function listUncoveredTags(groupSlug: string): Promise<UncoveredTag[]> {
  const groupId = (TAG_GROUP_IDS as Record<string, string>)[groupSlug]
  if (!groupId) return []

  const supabase = createAdminClient()
  const [tagsRes, proposalsRes] = await Promise.all([
    supabase.from("tags").select("id, name, slug").eq("tag_group_id", groupId).order("name"),
    supabase.from("tag_cluster_proposal").select("member_tag_ids").eq("group_slug", groupSlug),
  ])
  if (tagsRes.error) throw new Error(tagsRes.error.message)
  if (proposalsRes.error) throw new Error(proposalsRes.error.message)

  const covered = new Set<string>()
  for (const p of proposalsRes.data ?? []) {
    for (const id of (p.member_tag_ids as string[]) ?? []) covered.add(id)
  }

  return ((tagsRes.data ?? []) as UncoveredTag[]).filter((t) => !covered.has(t.id))
}

// Moves a tag from one proposal to another within the same group.
// - Removes the tag from the source proposal's member list (auto-rejects
//   the source if it ends up with <2 members).
// - Adds the tag to the target proposal's member list (no-op if already in).
// Both proposals must be in 'pending' or 'approved' state.
export async function moveTagBetweenProposals(
  tagId: string,
  fromProposalId: string,
  toProposalId: string,
): Promise<{ error?: string; sourceAutoRejected?: boolean }> {
  if (fromProposalId === toProposalId) return {}
  const supabase = createAdminClient()

  const { data: rows, error: selErr } = await supabase
    .from("tag_cluster_proposal")
    .select("id, group_slug, member_tag_ids, status")
    .in("id", [fromProposalId, toProposalId])
  if (selErr) return { error: selErr.message }
  if (!rows || rows.length !== 2) return { error: "uma das propostas não foi encontrada" }

  const source = rows.find((r) => r.id === fromProposalId)
  const target = rows.find((r) => r.id === toProposalId)
  if (!source || !target) return { error: "uma das propostas não foi encontrada" }
  if (source.group_slug !== target.group_slug) {
    return { error: "as propostas precisam estar no mesmo grupo" }
  }
  if (!["pending", "approved"].includes(source.status as string)) {
    return { error: "proposta de origem não pode ser modificada" }
  }
  if (!["pending", "approved"].includes(target.status as string)) {
    return { error: "proposta de destino não pode ser modificada" }
  }

  const sourceMembers = ((source.member_tag_ids as string[]) ?? []).filter((id) => id !== tagId)
  const targetMembers = (target.member_tag_ids as string[]) ?? []
  const newTargetMembers = targetMembers.includes(tagId) ? targetMembers : [...targetMembers, tagId]

  // Update target first (no risk of leaving things inconsistent if it fails).
  const { error: tErr } = await supabase
    .from("tag_cluster_proposal")
    .update({ member_tag_ids: newTargetMembers })
    .eq("id", toProposalId)
  if (tErr) return { error: tErr.message }

  // Then update source. Auto-reject if it now has <2 members.
  let sourceAutoRejected = false
  if (sourceMembers.length < 2) {
    const { error: sErr } = await supabase
      .from("tag_cluster_proposal")
      .update({
        member_tag_ids: sourceMembers,
        status: "rejected",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", fromProposalId)
    if (sErr) return { error: sErr.message }
    sourceAutoRejected = true
  } else {
    const { error: sErr } = await supabase
      .from("tag_cluster_proposal")
      .update({ member_tag_ids: sourceMembers })
      .eq("id", fromProposalId)
    if (sErr) return { error: sErr.message }
  }

  revalidatePath("/settings/tag-consolidation")
  return { sourceAutoRejected }
}

export async function moveTagToGroup(
  tagId: string,
  targetGroupSlug: string,
): Promise<{ error?: string }> {
  const targetGroupId = (TAG_GROUP_IDS as Record<string, string>)[targetGroupSlug]
  if (!targetGroupId) return { error: `Grupo "${targetGroupSlug}" não existe.` }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tags")
    .update({ tag_group_id: targetGroupId })
    .eq("id", tagId)
  if (error) return { error: error.message }

  revalidatePath("/settings/tag-consolidation")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  return {}
}

// ============================================================
// Group move proposals (audit-tag-groups.js → /settings/tag-consolidation tab)
// ============================================================

export type GroupMoveStatus = "pending" | "approved" | "rejected" | "applied"

export interface GroupMoveProposal {
  id: string
  tag_id: string
  tag_name: string
  tag_slug: string
  current_group_slug: string
  suggested_group_slug: string
  confidence: number
  rationale: string | null
  status: GroupMoveStatus
  reviewed_at: string | null
  applied_at: string | null
  created_at: string
}

export async function listGroupMoveProposals(
  status?: GroupMoveStatus,
): Promise<GroupMoveProposal[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("tag_group_move_proposal")
    .select("*")
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
  if (status) query = query.eq("status", status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return []

  // Resolve tag names/slugs.
  const tagIds = [...new Set(data.map((p) => p.tag_id as string))]
  const tagsById = new Map<string, { name: string; slug: string }>()
  const CHUNK = 100
  for (let i = 0; i < tagIds.length; i += CHUNK) {
    const { data: tagRows, error: tErr } = await supabase
      .from("tags")
      .select("id, name, slug")
      .in("id", tagIds.slice(i, i + CHUNK))
    if (tErr) throw new Error(tErr.message)
    for (const t of tagRows ?? []) {
      tagsById.set(t.id as string, { name: t.name as string, slug: t.slug as string })
    }
  }

  return data.map((p) => {
    const tag = tagsById.get(p.tag_id as string)
    return {
      id: p.id as string,
      tag_id: p.tag_id as string,
      tag_name: tag?.name ?? "(removida)",
      tag_slug: tag?.slug ?? "",
      current_group_slug: p.current_group_slug as string,
      suggested_group_slug: p.suggested_group_slug as string,
      confidence: Number(p.confidence),
      rationale: (p.rationale as string | null) ?? null,
      status: p.status as GroupMoveStatus,
      reviewed_at: p.reviewed_at as string | null,
      applied_at: p.applied_at as string | null,
      created_at: p.created_at as string,
    }
  })
}

export async function approveGroupMove(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_group_move_proposal")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function bulkSetGroupMoveStatus(
  ids: string[],
  status: "approved" | "rejected",
): Promise<{ updated: number; error?: string }> {
  if (ids.length === 0) return { updated: 0 }
  const supabase = createAdminClient()
  const fromStatuses = status === "approved" ? ["pending"] : ["pending", "approved"]
  const { data, error } = await supabase
    .from("tag_group_move_proposal")
    .update({ status, reviewed_at: new Date().toISOString() })
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return { updated: data?.length ?? 0 }
}

export async function rejectGroupMove(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_group_move_proposal")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function reopenGroupMove(id: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_group_move_proposal")
    .update({ status: "pending", reviewed_at: null })
    .eq("id", id)
    .in("status", ["approved", "rejected"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export async function editGroupMove(
  id: string,
  patch: { suggested_group_slug?: string },
): Promise<{ error?: string }> {
  if (!patch.suggested_group_slug) return {}
  if (!(TAG_GROUP_IDS as Record<string, string>)[patch.suggested_group_slug]) {
    return { error: `Grupo "${patch.suggested_group_slug}" não existe.` }
  }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tag_group_move_proposal")
    .update({ suggested_group_slug: patch.suggested_group_slug })
    .eq("id", id)
    .in("status", ["pending", "approved"])
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return {}
}

export interface ApplyGroupMovesResult {
  applied: number
  failed: number
  errors: string[]
}

export async function applyApprovedGroupMoves(): Promise<ApplyGroupMovesResult> {
  const supabase = createAdminClient()
  const { data: approved, error } = await supabase
    .from("tag_group_move_proposal")
    .select("*")
    .eq("status", "approved")
  if (error) return { applied: 0, failed: 0, errors: [error.message] }
  if (!approved || approved.length === 0) return { applied: 0, failed: 0, errors: [] }

  const result: ApplyGroupMovesResult = { applied: 0, failed: 0, errors: [] }
  for (const p of approved) {
    const move = await moveTagToGroup(p.tag_id as string, p.suggested_group_slug as string)
    if (move.error) {
      result.failed += 1
      result.errors.push(`${p.tag_id}: ${move.error}`)
      continue
    }
    const { error: updErr } = await supabase
      .from("tag_group_move_proposal")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", p.id)
    if (updErr) {
      result.failed += 1
      result.errors.push(`${p.tag_id}: ${updErr.message}`)
    } else {
      result.applied += 1
    }
  }

  revalidatePath("/settings/tag-consolidation")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  return result
}
