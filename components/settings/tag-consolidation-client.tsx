"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightLeft, Check, ChevronDown, ChevronUp, Pencil, RotateCcw, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TagGroupSlug } from "@/lib/constants/tag-groups"
import {
  applyApprovedGroupMoves,
  applyApprovedProposals,
  approveGroupMove,
  approveProposal,
  bulkSetGroupMoveStatus,
  bulkSetProposalStatus,
  editGroupMove,
  editProposal,
  moveTagBetweenProposals,
  moveTagToGroup,
  rejectGroupMove,
  rejectProposal,
  reopenGroupMove,
  reopenProposal,
  type GroupMoveProposal,
  type GroupMoveStatus,
  type ProposalStatus,
  type ProposalWithMembers,
  type UncoveredTag,
} from "@/server/actions/tag-consolidation"

type View = "clusters" | "groupmoves"

interface Props {
  view: View
  groups: Array<{ slug: TagGroupSlug; label: string }>
  initialGroup: TagGroupSlug | null
  initialStatus: ProposalStatus
  proposals: ProposalWithMembers[]
  uncoveredTags: UncoveredTag[]
  groupMoves: GroupMoveProposal[]
  pendingGroupMoveCount: number
}

const STATUSES: Array<{ value: ProposalStatus; label: string }> = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovadas" },
  { value: "rejected", label: "Rejeitadas" },
  { value: "applied", label: "Aplicadas" },
]

export function TagConsolidationClient({
  view,
  groups,
  initialGroup,
  initialStatus,
  proposals,
  uncoveredTags,
  groupMoves,
  pendingGroupMoveCount,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isApplying, setIsApplying] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkRunning, setIsBulkRunning] = useState(false)

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())
  const exitSelectionMode = () => {
    setSelectionMode(false)
    clearSelection()
  }
  const selectAll = (ids: string[]) => setSelectedIds(new Set(ids))

  const updateQuery = (patch: { view?: View; group?: string | null; status?: string }) => {
    const params = new URLSearchParams(window.location.search)
    if (patch.view) params.set("view", patch.view)
    if (patch.group !== undefined) {
      if (patch.group === null || patch.group === "all") params.delete("group")
      else params.set("group", patch.group)
    }
    if (patch.status) params.set("status", patch.status)
    router.replace(`/settings/tag-consolidation?${params.toString()}`, { scroll: false })
  }

  const switchView = (target: View) => {
    exitSelectionMode()
    const params = new URLSearchParams(window.location.search)
    params.set("view", target)
    // Reset status to pending on view change (different lifecycles).
    params.set("status", "pending")
    router.replace(`/settings/tag-consolidation?${params.toString()}`, { scroll: false })
  }

  const runBulkClusters = async (status: "approved" | "rejected") => {
    if (selectedIds.size === 0) return
    setIsBulkRunning(true)
    const ids = [...selectedIds]
    const { updated, error } = await bulkSetProposalStatus(ids, status)
    setIsBulkRunning(false)
    if (error) toast.error(error)
    else toast.success(`${updated} proposta${updated === 1 ? "" : "s"} ${status === "approved" ? "aprovada" : "rejeitada"}${updated === 1 ? "" : "s"}`)
    exitSelectionMode()
    refresh()
  }

  const runBulkGroupMoves = async (status: "approved" | "rejected") => {
    if (selectedIds.size === 0) return
    setIsBulkRunning(true)
    const ids = [...selectedIds]
    const { updated, error } = await bulkSetGroupMoveStatus(ids, status)
    setIsBulkRunning(false)
    if (error) toast.error(error)
    else toast.success(`${updated} mudança${updated === 1 ? "" : "s"} ${status === "approved" ? "aprovada" : "rejeitada"}${updated === 1 ? "" : "s"}`)
    exitSelectionMode()
    refresh()
  }

  const refresh = () => startTransition(() => router.refresh())

  const handleApprove = (id: string) => async () => {
    const { error } = await approveProposal(id)
    if (error) toast.error(error)
    else toast.success("Aprovado")
    refresh()
  }
  const handleReject = (id: string) => async () => {
    const { error } = await rejectProposal(id)
    if (error) toast.error(error)
    else toast.success("Rejeitado")
    refresh()
  }
  const handleReopen = (id: string) => async () => {
    const { error } = await reopenProposal(id)
    if (error) toast.error(error)
    else toast.success("Reaberto")
    refresh()
  }
  const handleEdit = (id: string, name: string, memberIds: string[]) => async () => {
    const { error, autoRejected } = await editProposal(id, {
      canonical_name: name,
      member_tag_ids: memberIds,
    })
    if (error) toast.error(error)
    else if (autoRejected) toast.success("Cluster ficou com <2 membros — proposta rejeitada automaticamente")
    else toast.success("Salvo")
    refresh()
  }

  const handleApply = async () => {
    if (!confirm("Aplicar todos os clusters aprovados? Esta operação é destrutiva (mescla tags e atualiza work_tags).")) return
    setIsApplying(true)
    try {
      const result = await applyApprovedProposals(initialGroup ?? undefined)
      if (result.errors.length > 0) {
        toast.error(`Aplicados ${result.applied}, falharam ${result.failed}. Veja console.`)
        console.error(result.errors)
      } else {
        toast.success(
          `${result.applied} clusters aplicados. ${result.tagsRemoved} tags removidas, ${result.workTagsRedirected} work_tags redirecionadas.`,
        )
      }
      refresh()
    } finally {
      setIsApplying(false)
    }
  }

  const approvedCount = initialStatus === "approved" ? proposals.length : null

  const handleApplyGroupMoves = async () => {
    if (!confirm("Aplicar todas as mudanças de grupo aprovadas?")) return
    setIsApplying(true)
    try {
      const result = await applyApprovedGroupMoves()
      if (result.errors.length > 0) {
        toast.error(`Aplicadas ${result.applied}, falharam ${result.failed}. Veja console.`)
        console.error(result.errors)
      } else {
        toast.success(`${result.applied} mudanças aplicadas.`)
      }
      refresh()
    } finally {
      setIsApplying(false)
    }
  }

  const handleApproveGroupMove = (id: string) => async () => {
    const { error } = await approveGroupMove(id)
    if (error) toast.error(error)
    else toast.success("Mudança aprovada")
    refresh()
  }
  const handleRejectGroupMove = (id: string) => async () => {
    const { error } = await rejectGroupMove(id)
    if (error) toast.error(error)
    else toast.success("Mudança rejeitada")
    refresh()
  }
  const handleReopenGroupMove = (id: string) => async () => {
    const { error } = await reopenGroupMove(id)
    if (error) toast.error(error)
    else toast.success("Reaberto")
    refresh()
  }
  const handleEditGroupMove = (id: string, suggestedSlug: string) => async () => {
    const { error } = await editGroupMove(id, { suggested_group_slug: suggestedSlug })
    if (error) toast.error(error)
    else toast.success("Salvo")
    refresh()
  }

  const visibleIds =
    view === "clusters"
      ? proposals.filter((p) => p.status !== "applied").map((p) => p.id)
      : groupMoves.filter((m) => m.status !== "applied").map((m) => m.id)

  return (
    <div className="space-y-4">
      {selectionMode && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/60 bg-primary/10 p-3 shadow-md backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.size} de {visibleIds.length} selecionada{visibleIds.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => selectAll(visibleIds)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Selecionar todas
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={selectedIds.size === 0 || isBulkRunning}
              onClick={() => (view === "clusters" ? runBulkClusters("approved") : runBulkGroupMoves("approved"))}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Aprovar ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || isBulkRunning}
              onClick={() => (view === "clusters" ? runBulkClusters("rejected") : runBulkGroupMoves("rejected"))}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Rejeitar ({selectedIds.size})
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelectionMode} disabled={isBulkRunning}>
              Sair
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-lg border border-border/65 bg-background/40 p-1">
        <button
          type="button"
          onClick={() => switchView("clusters")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            view === "clusters"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          Clusters semânticos
        </button>
        <button
          type="button"
          onClick={() => switchView("groupmoves")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            view === "groupmoves"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          Mudanças de grupo
          {pendingGroupMoveCount > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400/25 px-1.5 text-xs font-bold tabular-nums text-amber-200">
              {pendingGroupMoveCount}
            </span>
          )}
        </button>
      </div>

      {view === "groupmoves" ? (
        <GroupMovesPanel
          groupMoves={groupMoves}
          groups={groups}
          initialStatus={initialStatus}
          onSwitchStatus={(s) => {
            exitSelectionMode()
            updateQuery({ status: s })
          }}
          onApprove={handleApproveGroupMove}
          onReject={handleRejectGroupMove}
          onReopen={handleReopenGroupMove}
          onEdit={handleEditGroupMove}
          onApplyAll={handleApplyGroupMoves}
          isApplying={isApplying}
          isPending={isPending}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelected}
          onEnterSelection={() => setSelectionMode(true)}
        />
      ) : (
        <>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/65 bg-background/40 p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grupo</label>
          <Select
            value={initialGroup ?? "all"}
            onValueChange={(value) => updateQuery({ group: value })}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os grupos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.slug} value={g.slug}>{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
          <div className="flex gap-1 rounded-lg border border-border/65 bg-background/40 p-1">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  exitSelectionMode()
                  updateQuery({ status: s.value })
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  initialStatus === s.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!selectionMode && initialStatus !== "applied" && proposals.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
              Selecionar
            </Button>
          )}
          {(approvedCount && approvedCount > 0) || initialStatus !== "approved" ? (
            <Button
              variant="default"
              size="sm"
              onClick={handleApply}
              disabled={isApplying || isPending}
              title="Aplica os clusters aprovados deste grupo (ou todos se nenhum filtro de grupo). Operação destrutiva."
            >
              {isApplying ? "Aplicando…" : "Aplicar aprovados"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {proposals.length === 0
          ? "Nenhuma proposta neste filtro. Rode `node scripts/propose-tag-clusters.js --group <slug>` no terminal pra gerar propostas."
          : `${proposals.length} proposta${proposals.length === 1 ? "" : "s"}`}
      </div>

      <div className="space-y-2">
        {proposals.map((p) => {
          const siblingProposals = proposals
            .filter(
              (other) =>
                other.id !== p.id &&
                other.group_slug === p.group_slug &&
                (other.status === "pending" || other.status === "approved"),
            )
            .map((other) => ({ id: other.id, canonical_name: other.canonical_name }))
          return (
            <ProposalCard
              key={p.id}
              proposal={p}
              groups={groups}
              currentGroupSlug={p.group_slug}
              siblingProposals={siblingProposals}
              onApprove={handleApprove(p.id)}
              onReject={handleReject(p.id)}
              onReopen={handleReopen(p.id)}
              onSaveEdit={(name, memberIds) => handleEdit(p.id, name, memberIds)()}
              onRefresh={refresh}
              isPending={isPending}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSelected(p.id)}
            />
          )
        })}
      </div>

      {initialGroup && uncoveredTags.length > 0 && (
        <UncoveredTagsSection
          groupSlug={initialGroup}
          tags={uncoveredTags}
          groups={groups}
          onMoved={refresh}
          isPending={isPending}
        />
      )}
        </>
      )}
    </div>
  )
}

interface GroupMovesPanelProps {
  groupMoves: GroupMoveProposal[]
  groups: Array<{ slug: TagGroupSlug; label: string }>
  initialStatus: ProposalStatus
  onSwitchStatus: (s: ProposalStatus) => void
  onApprove: (id: string) => () => void
  onReject: (id: string) => () => void
  onReopen: (id: string) => () => void
  onEdit: (id: string, suggestedSlug: string) => () => void
  onApplyAll: () => void
  isApplying: boolean
  isPending: boolean
  selectionMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEnterSelection: () => void
}

const STATUS_AS_GROUP_MOVE: Record<ProposalStatus, GroupMoveStatus> = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  applied: "applied",
}

function GroupMovesPanel({
  groupMoves,
  groups,
  initialStatus,
  onSwitchStatus,
  onApprove,
  onReject,
  onReopen,
  onEdit,
  onApplyAll,
  isApplying,
  isPending,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onEnterSelection,
}: GroupMovesPanelProps) {
  const groupLabel = (slug: string) =>
    groups.find((g) => g.slug === slug)?.label ?? slug
  const currentStatus = STATUS_AS_GROUP_MOVE[initialStatus]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/65 bg-background/40 p-3">
        <div className="flex gap-1 rounded-lg border border-border/65 bg-background/40 p-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onSwitchStatus(s.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                initialStatus === s.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {!selectionMode && currentStatus !== "applied" && groupMoves.length > 0 && (
            <Button variant="outline" size="sm" onClick={onEnterSelection}>
              Selecionar
            </Button>
          )}
          {currentStatus === "approved" && groupMoves.length > 0 && (
            <Button size="sm" onClick={onApplyAll} disabled={isApplying || isPending}>
              {isApplying ? "Aplicando…" : `Aplicar ${groupMoves.length} aprovadas`}
            </Button>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {groupMoves.length === 0
          ? "Nenhuma proposta neste filtro. Rode `node scripts/audit-tag-groups.js` no terminal pra gerar."
          : `${groupMoves.length} proposta${groupMoves.length === 1 ? "" : "s"}`}
      </div>

      <div className="space-y-2">
        {groupMoves.map((m) => (
          <GroupMoveCard
            key={m.id}
            move={m}
            groups={groups}
            onApprove={onApprove(m.id)}
            onReject={onReject(m.id)}
            onReopen={onReopen(m.id)}
            onSaveEdit={(slug) => onEdit(m.id, slug)()}
            groupLabel={groupLabel}
            isPending={isPending}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(m.id)}
            onToggleSelect={() => onToggleSelect(m.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface GroupMoveCardProps {
  move: GroupMoveProposal
  groups: Array<{ slug: TagGroupSlug; label: string }>
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
  onSaveEdit: (suggestedSlug: string) => void
  groupLabel: (slug: string) => string
  isPending: boolean
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
}

function GroupMoveCard({
  move: m,
  groups,
  onApprove,
  onReject,
  onReopen,
  onSaveEdit,
  groupLabel,
  isPending,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: GroupMoveCardProps) {
  const [editing, setEditing] = useState(false)
  const [draftSlug, setDraftSlug] = useState(m.suggested_group_slug)
  const [showRationale, setShowRationale] = useState(false)

  const confidencePct = Math.round(m.confidence * 100)
  const statusBadge: Record<GroupMoveStatus, { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-amber-400/15 text-amber-200 border-amber-400/30" },
    approved: { label: "Aprovada", cls: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30" },
    rejected: { label: "Rejeitada", cls: "bg-rose-400/15 text-rose-200 border-rose-400/30" },
    applied: { label: "Aplicada", cls: "bg-sky-400/15 text-sky-200 border-sky-400/30" },
  }
  const sb = statusBadge[m.status]
  const isLocked = m.status === "applied"
  const isSelectable = selectionMode && !isLocked

  return (
    <div
      className={`rounded-lg border bg-background/45 p-4 transition-colors ${
        isSelected ? "border-primary/60 bg-primary/[0.05]" : "border-border/65"
      } ${isSelectable ? "cursor-pointer hover:border-primary/40" : ""}`}
      onClick={isSelectable ? onToggleSelect : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {selectionMode && (
            <Checkbox
              checked={isSelected}
              disabled={isLocked}
              onCheckedChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="mt-1"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{m.tag_name}</span>
            <span className="text-xs text-muted-foreground">
              {groupLabel(m.current_group_slug)} → {editing ? "" : groupLabel(m.suggested_group_slug)}
            </span>
            {editing && (
              <select
                value={draftSlug}
                onChange={(e) => setDraftSlug(e.target.value)}
                className="h-7 rounded-md border border-border/65 bg-background px-2 text-xs"
              >
                {groups
                  .filter((g) => g.slug !== m.current_group_slug)
                  .map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.label}
                    </option>
                  ))}
              </select>
            )}
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sb.cls}`}>
              {sb.label}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                confidencePct >= 90
                  ? "bg-emerald-400/15 text-emerald-200"
                  : confidencePct >= 80
                    ? "bg-sky-400/15 text-sky-200"
                    : "bg-amber-400/15 text-amber-200"
              }`}
            >
              {confidencePct}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            slug: <code className="rounded bg-muted/40 px-1 py-0.5">{m.tag_slug}</code>
          </div>
          </div>
        </div>

        {!isLocked && !selectionMode && (
          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="default"
                  disabled={isPending || draftSlug === m.suggested_group_slug}
                  onClick={() => {
                    onSaveEdit(draftSlug)
                    setEditing(false)
                  }}
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Salvar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraftSlug(m.suggested_group_slug)
                    setEditing(false)
                  }}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={isPending} title="Editar destino">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {m.status === "pending" && (
                  <>
                    <Button size="sm" variant="default" onClick={onApprove} disabled={isPending}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending}>
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                  </>
                )}
                {m.status === "approved" && (
                  <>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending}>
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending} title="Reabrir">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {m.status === "rejected" && (
                  <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {m.rationale && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRationale((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showRationale ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Justificativa
          </button>
          {showRationale && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.rationale}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface UncoveredSectionProps {
  groupSlug: string
  tags: UncoveredTag[]
  groups: Array<{ slug: TagGroupSlug; label: string }>
  onMoved: () => void
  isPending: boolean
}

function UncoveredTagsSection({
  groupSlug,
  tags,
  groups,
  onMoved,
  isPending,
}: UncoveredSectionProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="text-sm font-semibold">Outras tags do grupo</span>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tags.length}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">não estão em nenhuma proposta</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <MemberChip
              key={t.id}
              tagId={t.id}
              name={t.name}
              slug={t.slug}
              isCanonical={false}
              groups={groups}
              currentGroupSlug={groupSlug}
              disabled={isPending}
              onMoved={onMoved}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  proposal: ProposalWithMembers
  groups: Array<{ slug: TagGroupSlug; label: string }>
  currentGroupSlug: string
  siblingProposals: Array<{ id: string; canonical_name: string }>
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
  onSaveEdit: (canonicalName: string, memberIds: string[]) => void
  onRefresh: () => void
  isPending: boolean
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
}

function ProposalCard({
  proposal: p,
  groups,
  currentGroupSlug,
  siblingProposals,
  onApprove,
  onReject,
  onReopen,
  onSaveEdit,
  onRefresh,
  isPending,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: CardProps) {
  const [editing, setEditing] = useState(false)
  const [showRationale, setShowRationale] = useState(false)
  const [draftName, setDraftName] = useState(p.canonical_name)
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>(
    p.members.map((m) => m.id),
  )

  const confidencePct = Math.round(p.confidence * 100)
  const statusBadge: Record<ProposalStatus, { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-amber-400/15 text-amber-200 border-amber-400/30" },
    approved: { label: "Aprovada", cls: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30" },
    rejected: { label: "Rejeitada", cls: "bg-rose-400/15 text-rose-200 border-rose-400/30" },
    applied: { label: "Aplicada", cls: "bg-sky-400/15 text-sky-200 border-sky-400/30" },
  }
  const sb = statusBadge[p.status]

  const isLocked = p.status === "applied"

  const toggleMember = (id: string) => {
    setDraftMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const isSelectable = selectionMode && p.status !== "applied"
  return (
    <div
      className={`rounded-lg border bg-background/45 p-4 transition-colors ${
        isSelected ? "border-primary/60 bg-primary/[0.05]" : "border-border/65"
      } ${isSelectable ? "cursor-pointer hover:border-primary/40" : ""}`}
      onClick={isSelectable ? onToggleSelect : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {selectionMode && (
            <Checkbox
              checked={isSelected}
              disabled={p.status === "applied"}
              onCheckedChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="mt-1"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="h-8 max-w-xs"
              />
            ) : (
              <span className="text-base font-semibold">{p.canonical_name}</span>
            )}
            <span className="text-xs text-muted-foreground">{p.group_slug}</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sb.cls}`}>
              {sb.label}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                confidencePct >= 90
                  ? "bg-emerald-400/15 text-emerald-200"
                  : confidencePct >= 80
                    ? "bg-sky-400/15 text-sky-200"
                    : "bg-amber-400/15 text-amber-200"
              }`}
            >
              {confidencePct}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            slug: <code className="rounded bg-muted/40 px-1 py-0.5">{p.canonical_slug}</code>
          </div>
          </div>
        </div>

        {!isLocked && !selectionMode && (
          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="default"
                  disabled={isPending || !draftName.trim()}
                  title={draftMemberIds.length < 2 ? "Cluster ficará com <2 membros — proposta será rejeitada" : undefined}
                  onClick={() => {
                    onSaveEdit(draftName.trim(), draftMemberIds)
                    setEditing(false)
                  }}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  {draftMemberIds.length < 2 ? "Salvar (rejeitar)" : "Salvar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraftName(p.canonical_name)
                    setDraftMemberIds(p.members.map((m) => m.id))
                    setEditing(false)
                  }}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={isPending} title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {p.status === "pending" && (
                  <>
                    <Button size="sm" variant="default" onClick={onApprove} disabled={isPending} title="Aprovar">
                      <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending} title="Rejeitar">
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                  </>
                )}
                {p.status === "approved" && (
                  <>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending} title="Rejeitar">
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending} title="Reabrir">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {p.status === "rejected" && (
                  <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending} title="Reabrir">
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.members.map((m) => {
          const included = draftMemberIds.includes(m.id)
          const isCanonical = m.name.toLowerCase() === (editing ? draftName : p.canonical_name).toLowerCase()
          if (editing && !isLocked) {
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  included
                    ? "border-primary/55 bg-primary/15 text-primary"
                    : "border-border/65 bg-background/45 text-muted-foreground line-through"
                }`}
                title={included ? "Remover do cluster" : "Reincluir no cluster"}
              >
                <span>{m.name}</span>
                {!included && <Trash2 className="h-3 w-3" />}
              </button>
            )
          }
          return (
            <MemberChip
              key={m.id}
              tagId={m.id}
              name={m.name}
              slug={m.slug}
              isCanonical={isCanonical}
              groups={groups}
              currentGroupSlug={currentGroupSlug}
              sourceProposalId={p.id}
              siblingProposals={siblingProposals}
              disabled={isLocked || isPending}
              onMoved={onRefresh}
            />
          )
        })}
      </div>

      {p.rationale && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRationale((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showRationale ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Justificativa
          </button>
          {showRationale && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.rationale}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface MemberChipProps {
  tagId: string
  name: string
  slug: string
  isCanonical: boolean
  groups: Array<{ slug: TagGroupSlug; label: string }>
  currentGroupSlug: string
  sourceProposalId?: string
  siblingProposals?: Array<{ id: string; canonical_name: string }>
  disabled: boolean
  onMoved: () => void
}

function MemberChip({
  tagId,
  name,
  slug,
  isCanonical,
  groups,
  currentGroupSlug,
  sourceProposalId,
  siblingProposals = [],
  disabled,
  onMoved,
}: MemberChipProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleMoveGroup = async (targetSlug: string) => {
    if (targetSlug === currentGroupSlug) {
      setOpen(false)
      return
    }
    setBusy(true)
    const { error } = await moveTagToGroup(tagId, targetSlug)
    setBusy(false)
    if (error) {
      toast.error(error)
    } else {
      toast.success(`"${name}" movido para o grupo ${targetSlug}`)
      setOpen(false)
      onMoved()
    }
  }

  const handleMoveProposal = async (targetProposalId: string) => {
    if (!sourceProposalId) return
    setBusy(true)
    const { error, sourceAutoRejected } = await moveTagBetweenProposals(
      tagId,
      sourceProposalId,
      targetProposalId,
    )
    setBusy(false)
    if (error) {
      toast.error(error)
    } else {
      toast.success(
        sourceAutoRejected
          ? `"${name}" movido — cluster original rejeitado (ficou com <2)`
          : `"${name}" movido para outra proposta`,
      )
      setOpen(false)
      onMoved()
    }
  }

  const targetGroups = groups.filter((g) => g.slug !== currentGroupSlug)
  const sortedSiblings = [...siblingProposals].sort((a, b) =>
    a.canonical_name.localeCompare(b.canonical_name),
  )
  const canMoveBetweenProposals = sourceProposalId && sortedSiblings.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`slug: ${slug} — clique para mover`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            isCanonical
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:border-primary/55"
          } disabled:cursor-default disabled:opacity-60`}
        >
          <span>{name}</span>
          {!disabled && <ArrowRightLeft className="h-2.5 w-2.5 opacity-50" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        {canMoveBetweenProposals && (
          <>
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Mover para outra proposta (mesmo grupo)
            </div>
            <div className="max-h-56 overflow-y-auto">
              {sortedSiblings.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleMoveProposal(s.id)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
                >
                  <span className="truncate">{s.canonical_name}</span>
                </button>
              ))}
            </div>
            <div className="my-1 border-t border-border/60" />
          </>
        )}
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Mover para outro grupo
        </div>
        <div className="max-h-56 overflow-y-auto">
          {targetGroups.map((g) => (
            <button
              key={g.slug}
              type="button"
              disabled={busy}
              onClick={() => handleMoveGroup(g.slug)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
            >
              <span>{g.label}</span>
              <span className="text-[10px] text-muted-foreground">{g.slug}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
