import { TagConsolidationClient } from "@/components/settings/tag-consolidation-client"
import {
  listGroupMoveProposals,
  listGroupSlugs,
  listProposals,
  listUncoveredTags,
  type GroupMoveProposal,
  type GroupMoveStatus,
  type ProposalStatus,
  type ProposalWithMembers,
  type UncoveredTag,
} from "@/server/actions/tag-consolidation"
import {
  listSubgroupAssignments,
  listSubgroups,
  listUnassignedTags,
  type Subgroup,
  type SubgroupStatus,
  type SubgroupWithTags,
  type UnassignedTag as UnassignedSubgroupTag,
} from "@/server/actions/tag-subgroups"
import { listNewTags, listGenreProposals, type NewTagRow, type GenreProposalRow } from "@/server/actions/tag-review"
import { GENRE_PROPOSAL_MIN_OCCURRENCES } from "@/lib/tags/genre-proposals"
import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"

const VALID_STATUSES: ProposalStatus[] = ["pending", "approved", "rejected", "applied"]
const VALID_SUBGROUP_STATUSES: SubgroupStatus[] = ["pending", "approved", "rejected"]
type View = "clusters" | "groupmoves" | "subgroups" | "tags-novas" | "genres"
type SubgroupPhase = "define" | "assign"

export interface TagConsolidationParams {
  view?: string
  group?: string
  status?: string
  phase?: string
}

/**
 * Ferramenta de Consolidação de tags (clusters + mudanças de grupo + sub-grupos).
 * Extraída da página `/settings/tag-consolidation` pra ser reusada tanto lá
 * (`basePath` default) quanto inline na pilha de /settings (`basePath="/settings"`,
 * pra a navegação de filtros ficar no card em vez de trocar de rota).
 */
export async function TagConsolidationTool({
  params,
  basePath = "/settings/tag-consolidation",
}: {
  params: TagConsolidationParams
  basePath?: string
}) {
  const view: View =
    params.view === "groupmoves"
      ? "groupmoves"
      : params.view === "subgroups"
        ? "subgroups"
        : params.view === "tags-novas"
          ? "tags-novas"
          : params.view === "genres"
            ? "genres"
            : "clusters"
  const groupSlug = params.group && params.group !== "all" ? params.group : undefined
  const status = (params.status && VALID_STATUSES.includes(params.status as ProposalStatus)
    ? (params.status as ProposalStatus)
    : "pending") as ProposalStatus
  const subgroupPhase: SubgroupPhase = params.phase === "assign" ? "assign" : "define"
  const subgroupStatus = (params.status && VALID_SUBGROUP_STATUSES.includes(params.status as SubgroupStatus)
    ? (params.status as SubgroupStatus)
    : "pending") as SubgroupStatus

  const groups = await listGroupSlugs()

  let proposals: ProposalWithMembers[] = []
  let uncovered: UncoveredTag[] = []
  let groupMoves: GroupMoveProposal[] = []
  let pendingGroupMoveCount = 0
  let subgroups: Subgroup[] = []
  let subgroupsWithTags: SubgroupWithTags[] = []
  let unassignedSubgroupTags: UnassignedSubgroupTag[] = []
  let newTags: NewTagRow[] = []
  let genreProposals: GenreProposalRow[] = []

  // Contagens sempre (badges nas abas). Head-count barato via service role.
  const admin = createAdminClient()
  const [{ count: newTagsCount }, { count: genreProposalsCount }] = await Promise.all([
    admin.from("tags").select("*", { count: "exact", head: true }).eq("origin", "external").is("reviewed_at", null),
    admin
      .from("genre_proposal")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("occurrences", GENRE_PROPOSAL_MIN_OCCURRENCES),
  ])

  if (view === "tags-novas") {
    newTags = await listNewTags()
  } else if (view === "genres") {
    genreProposals = await listGenreProposals("pending")
  } else if (view === "clusters") {
    const [p, u, gmAll] = await Promise.all([
      listProposals(groupSlug, status),
      groupSlug ? listUncoveredTags(groupSlug) : Promise.resolve([] as UncoveredTag[]),
      listGroupMoveProposals("pending"),
    ])
    proposals = p
    uncovered = u
    pendingGroupMoveCount = gmAll.length
  } else if (view === "groupmoves") {
    const [gm, gmAll] = await Promise.all([
      listGroupMoveProposals(status as GroupMoveStatus),
      listGroupMoveProposals("pending"),
    ])
    groupMoves = gm
    pendingGroupMoveCount = gmAll.length
  } else {
    const gmAll = await listGroupMoveProposals("pending")
    pendingGroupMoveCount = gmAll.length
    if (subgroupPhase === "define") {
      subgroups = await listSubgroups(groupSlug, subgroupStatus)
    } else if (groupSlug) {
      const [sw, un] = await Promise.all([
        listSubgroupAssignments(groupSlug),
        listUnassignedTags(groupSlug),
      ])
      subgroupsWithTags = sw
      unassignedSubgroupTags = un
    }
  }

  const groupOptions = groups.map((slug) => ({
    slug,
    label: (TAG_GROUP_LABELS as Record<string, string>)[slug] ?? slug,
  }))

  return (
    <TagConsolidationClient
      view={view}
      groups={groupOptions as Array<{ slug: TagGroupSlug; label: string }>}
      initialGroup={(groupSlug as TagGroupSlug | undefined) ?? null}
      initialStatus={status}
      proposals={proposals}
      uncoveredTags={uncovered}
      groupMoves={groupMoves}
      pendingGroupMoveCount={pendingGroupMoveCount}
      subgroupPhase={subgroupPhase}
      subgroupStatus={subgroupStatus}
      subgroups={subgroups}
      subgroupsWithTags={subgroupsWithTags}
      unassignedSubgroupTags={unassignedSubgroupTags}
      newTags={newTags}
      newTagsCount={newTagsCount ?? 0}
      genreProposals={genreProposals}
      genreProposalsCount={genreProposalsCount ?? 0}
      basePath={basePath}
    />
  )
}
