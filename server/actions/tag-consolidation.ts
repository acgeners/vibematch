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
  status: "approved" | "rejected" | "pending",
): Promise<{ updated: number; error?: string }> {
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
    .from("tag_cluster_proposal")
    .update(patch)
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return { updated: data?.length ?? 0 }
}

export async function bulkDeleteClusterProposals(
  ids: string[],
): Promise<{ deleted: number; error?: string }> {
  if (ids.length === 0) return { deleted: 0 }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tag_cluster_proposal")
    .delete()
    .in("id", ids)
    .neq("status", "applied")
    .select("id")
  if (error) {
    console.error("[bulkDeleteClusterProposals] failed", { ids, error })
    return { deleted: 0, error: error.message }
  }
  revalidatePath("/settings/tag-consolidation")
  return { deleted: data?.length ?? 0 }
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

// Returns all tags in the given group (ordered by name), regardless of
// whether they are already members of a proposal. Used by the manual
// cluster creation modal.
export async function listAllTagsInGroup(groupSlug: string): Promise<UncoveredTag[]> {
  const groupId = (TAG_GROUP_IDS as Record<string, string>)[groupSlug]
  if (!groupId) return []

  const supabase = createAdminClient()
  const all: UncoveredTag[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, name, slug")
      .eq("tag_group_id", groupId)
      .order("name", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...(data as UncoveredTag[]))
    if (data.length < PAGE) break
  }
  return all
}

// Create a cluster proposal manually (without AI). Inserts as `pending`
// with confidence 1.0 so the operator can still review/edit/approve via
// the same workflow as AI proposals.
export async function createManualCluster(input: {
  group_slug: string
  canonical_name: string
  member_tag_ids: string[]
}): Promise<{ id?: string; error?: string }> {
  const groupId = (TAG_GROUP_IDS as Record<string, string>)[input.group_slug]
  if (!groupId) return { error: `grupo "${input.group_slug}" não encontrado` }
  const canonicalName = input.canonical_name.trim()
  if (!canonicalName) return { error: "canonical_name é obrigatório" }
  const memberIds = [...new Set(input.member_tag_ids)]
  if (memberIds.length < 2) return { error: "cluster precisa de pelo menos 2 tags" }
  const canonicalSlug = slugifyTagName(canonicalName)
  if (!canonicalSlug) return { error: "canonical_name inválido" }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tag_cluster_proposal")
    .insert({
      group_slug: input.group_slug,
      canonical_name: canonicalName,
      canonical_slug: canonicalSlug,
      member_tag_ids: memberIds,
      confidence: 1.0,
      rationale: "Criado manualmente",
      status: "pending",
    })
    .select("id")
    .single()
  if (error) return { error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return { id: data.id as string }
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
): Promise<{ error?: string; removedFromProposals?: number; autoRejectedProposals?: number }> {
  const supabase = createAdminClient()

  const { data: group, error: groupErr } = await supabase
    .from("tag_group")
    .select("id, slug")
    .eq("slug", targetGroupSlug)
    .maybeSingle()
  if (groupErr) {
    console.error("[moveTagToGroup] failed to resolve target group", {
      tagId,
      targetGroupSlug,
      error: groupErr,
    })
    return { error: `Falha ao buscar grupo: ${groupErr.message}` }
  }
  if (!group) {
    return { error: `Grupo "${targetGroupSlug}" não existe no Supabase.` }
  }

  const { data: currentTag, error: tagFetchErr } = await supabase
    .from("tags")
    .select("id, name, tag_group_id")
    .eq("id", tagId)
    .maybeSingle()
  if (tagFetchErr) {
    console.error("[moveTagToGroup] failed to fetch current tag", { tagId, error: tagFetchErr })
    return { error: `Falha ao buscar tag: ${tagFetchErr.message}` }
  }
  if (!currentTag) {
    return { error: `Tag id=${tagId} não encontrada.` }
  }

  let previousGroupSlug: string | null = null
  if (currentTag.tag_group_id) {
    const { data: prevGroup } = await supabase
      .from("tag_group")
      .select("slug")
      .eq("id", currentTag.tag_group_id)
      .maybeSingle()
    previousGroupSlug = prevGroup?.slug ?? null
  }
  console.log("[moveTagToGroup] previous group resolved", {
    tagId,
    previousGroupSlug,
    previousGroupId: currentTag.tag_group_id,
  })

  const { data: updated, error } = await supabase
    .from("tags")
    .update({ tag_group_id: group.id })
    .eq("id", tagId)
    .select("id, name, slug, tag_group_id")
  if (error) {
    console.error("[moveTagToGroup] update failed", {
      tagId,
      targetGroupSlug,
      targetGroupId: group.id,
      error,
    })
    const parts = [error.message, error.details, error.hint].filter(Boolean)
    return { error: parts.join(" — ") }
  }
  if (!updated || updated.length === 0) {
    console.error("[moveTagToGroup] update affected 0 rows", {
      tagId,
      targetGroupSlug,
      targetGroupId: group.id,
    })
    return {
      error: `Nenhuma linha atualizada. Tag id=${tagId} pode não existir, ou RLS bloqueou o UPDATE.`,
    }
  }

  let removedFromProposals = 0
  let autoRejectedProposals = 0

  {
    const { data: relatedProposals, error: relErr } = await supabase
      .from("tag_cluster_proposal")
      .select("id, group_slug, member_tag_ids, status")
      .in("status", ["pending", "approved"])
      .contains("member_tag_ids", [tagId])
    const orphan = (relatedProposals ?? []).filter((p) => p.group_slug !== targetGroupSlug)
    console.log("[moveTagToGroup] related proposals query", {
      previousGroupSlug,
      targetGroupSlug,
      tagId,
      foundTotal: relatedProposals?.length ?? 0,
      orphanCount: orphan.length,
      orphans: orphan.map((p) => ({ id: p.id, group_slug: p.group_slug, status: p.status })),
    })
    if (relErr) {
      console.error("[moveTagToGroup] failed to fetch related proposals", { tagId, error: relErr })
    } else if (orphan.length > 0) {
      for (const p of orphan) {
        const remaining = ((p.member_tag_ids as string[]) ?? []).filter((id) => id !== tagId)
        if (remaining.length < 2) {
          const { error: rejErr } = await supabase
            .from("tag_cluster_proposal")
            .update({
              member_tag_ids: remaining,
              status: "rejected",
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", p.id)
          if (rejErr) {
            console.error("[moveTagToGroup] failed to auto-reject proposal", { id: p.id, error: rejErr })
          } else {
            autoRejectedProposals += 1
          }
        } else {
          const { error: updErr } = await supabase
            .from("tag_cluster_proposal")
            .update({ member_tag_ids: remaining })
            .eq("id", p.id)
          if (updErr) {
            console.error("[moveTagToGroup] failed to remove tag from proposal", { id: p.id, error: updErr })
          } else {
            removedFromProposals += 1
          }
        }
      }
    }
  }

  console.log("[moveTagToGroup] success", {
    tagId,
    name: updated[0]?.name,
    previousGroupSlug,
    targetGroupSlug,
    targetGroupId: group.id,
    removedFromProposals,
    autoRejectedProposals,
  })

  revalidatePath("/settings/tag-consolidation")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  return { removedFromProposals, autoRejectedProposals }
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
  status: "approved" | "rejected" | "pending",
): Promise<{ updated: number; error?: string }> {
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
    .from("tag_group_move_proposal")
    .update(patch)
    .in("id", ids)
    .in("status", fromStatuses)
    .select("id")
  if (error) return { updated: 0, error: error.message }
  revalidatePath("/settings/tag-consolidation")
  return { updated: data?.length ?? 0 }
}

export async function bulkDeleteGroupMoves(
  ids: string[],
): Promise<{ deleted: number; error?: string }> {
  if (ids.length === 0) return { deleted: 0 }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tag_group_move_proposal")
    .delete()
    .in("id", ids)
    .neq("status", "applied")
    .select("id")
  if (error) {
    console.error("[bulkDeleteGroupMoves] failed", { ids, error })
    return { deleted: 0, error: error.message }
  }
  revalidatePath("/settings/tag-consolidation")
  return { deleted: data?.length ?? 0 }
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

// ============================================================
// Delete cluster proposal (permanently)
// ============================================================

export async function deleteClusterProposal(
  id: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = createAdminClient()

  const { data: proposal, error: fetchErr } = await supabase
    .from("tag_cluster_proposal")
    .select("id, status, canonical_name")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) return { error: `Falha ao buscar proposta: ${fetchErr.message}` }
  if (!proposal) return { error: "Proposta não encontrada." }
  if (proposal.status === "applied") {
    return { error: "Propostas aplicadas não podem ser deletadas (registro de auditoria)." }
  }

  const { error: delErr } = await supabase
    .from("tag_cluster_proposal")
    .delete()
    .eq("id", id)
  if (delErr) {
    console.error("[deleteClusterProposal] delete failed", { id, error: delErr })
    const parts = [delErr.message, delErr.details, delErr.hint].filter(Boolean)
    return { error: parts.join(" — ") }
  }

  console.log("[deleteClusterProposal] deleted", { id, canonical_name: proposal.canonical_name })
  revalidatePath("/settings/tag-consolidation")
  return { ok: true }
}
