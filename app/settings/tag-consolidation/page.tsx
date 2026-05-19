import { Header } from "@/components/layout/header"
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
import { TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"

interface PageProps {
  searchParams: Promise<{ view?: string; group?: string; status?: string }>
}

const VALID_STATUSES: ProposalStatus[] = ["pending", "approved", "rejected", "applied"]
type View = "clusters" | "groupmoves"

export default async function TagConsolidationPage({ searchParams }: PageProps) {
  const params = await searchParams
  const view: View = params.view === "groupmoves" ? "groupmoves" : "clusters"
  const groupSlug = params.group && params.group !== "all" ? params.group : undefined
  const status = (params.status && VALID_STATUSES.includes(params.status as ProposalStatus)
    ? (params.status as ProposalStatus)
    : "pending") as ProposalStatus

  const groups = await listGroupSlugs()

  let proposals: ProposalWithMembers[] = []
  let uncovered: UncoveredTag[] = []
  let groupMoves: GroupMoveProposal[] = []
  let pendingGroupMoveCount = 0

  if (view === "clusters") {
    const [p, u, gmAll] = await Promise.all([
      listProposals(groupSlug, status),
      groupSlug ? listUncoveredTags(groupSlug) : Promise.resolve([] as UncoveredTag[]),
      listGroupMoveProposals("pending"),
    ])
    proposals = p
    uncovered = u
    pendingGroupMoveCount = gmAll.length
  } else {
    const [gm, gmAll] = await Promise.all([
      listGroupMoveProposals(status as GroupMoveStatus),
      listGroupMoveProposals("pending"),
    ])
    groupMoves = gm
    pendingGroupMoveCount = gmAll.length
  }

  const groupOptions = groups.map((slug) => ({
    slug,
    label: (TAG_GROUP_LABELS as Record<string, string>)[slug] ?? slug,
  }))

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Configurações"
        title="Consolidação de tags"
        description="Revise os clusters semânticos propostos pela IA e aplique os aprovados. As tags membro são mescladas na canonical e os work_tags são redirecionados automaticamente."
      />
      <TagConsolidationClient
        view={view}
        groups={groupOptions as Array<{ slug: TagGroupSlug; label: string }>}
        initialGroup={(groupSlug as TagGroupSlug | undefined) ?? null}
        initialStatus={status}
        proposals={proposals}
        uncoveredTags={uncovered}
        groupMoves={groupMoves}
        pendingGroupMoveCount={pendingGroupMoveCount}
      />
    </div>
  )
}
