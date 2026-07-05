"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { ArrowRightLeft, Check, ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TagGroupSlug } from "@/lib/constants/tag-groups"
import {
  applyApprovedAssignments,
  approveSubgroup,
  bulkSetAssignmentStatus,
  bulkSetSubgroupStatus,
  createSubgroup,
  deleteSubgroup,
  editSubgroup,
  moveTagsToOtherGroup,
  moveTagsToSubgroup,
  moveTagToOtherGroup,
  moveTagToSubgroup,
  rejectSubgroup,
  reopenSubgroup,
  unassignTag,
} from "@/server/actions/tag-subgroups"
import type {
  AssignmentTag,
  Subgroup,
  SubgroupStatus,
  SubgroupWithTags,
  UnassignedTag,
} from "@/server/actions/tag-subgroups"

type Phase = "define" | "assign"

interface Props {
  groups: Array<{ slug: TagGroupSlug; label: string }>
  initialGroup: TagGroupSlug | null
  phase: Phase
  initialStatus: SubgroupStatus
  subgroups: Subgroup[]
  subgroupsWithTags: SubgroupWithTags[]
  unassignedTags: UnassignedTag[]
  /** Rota que a navegação de filtros reescreve (default = página dedicada). */
  basePath?: string
}

const SUB_STATUSES: Array<{ value: SubgroupStatus; label: string }> = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovados" },
  { value: "rejected", label: "Rejeitados" },
]

const STATUS_BADGE: Record<SubgroupStatus, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-amber-400/15 text-amber-200 border-amber-400/30" },
  approved: { label: "Aprovado", cls: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30" },
  rejected: { label: "Rejeitado", cls: "bg-rose-400/15 text-rose-200 border-rose-400/30" },
}

export function TagSubgroupsPanel({
  groups,
  initialGroup,
  phase,
  initialStatus,
  subgroups,
  subgroupsWithTags,
  unassignedTags,
  basePath = "/settings/tag-consolidation",
}: Props) {
  const router = useRouter() // mantido pro router.replace em updateQuery
  const doRefresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkRunning, setIsBulkRunning] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = () => startTransition(() => doRefresh())
  const clearSelection = () => setSelectedIds(new Set())
  const exitSelectionMode = () => {
    setSelectionMode(false)
    clearSelection()
  }
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const updateQuery = (patch: { group?: string | null; phase?: Phase; status?: string }) => {
    const params = new URLSearchParams(window.location.search)
    params.set("view", "subgroups")
    if (patch.group !== undefined) {
      if (patch.group === null || patch.group === "all") params.delete("group")
      else params.set("group", patch.group)
    }
    if (patch.phase) params.set("phase", patch.phase)
    if (patch.status) params.set("status", patch.status)
    router.replace(`${basePath}?${params.toString()}`, { scroll: false })
  }

  // ---- Phase 1 handlers ----
  const handleApprove = (id: string) => async () => {
    const { error } = await approveSubgroup(id)
    if (error) toast.error(error)
    else toast.success("Aprovado")
    refresh()
  }
  const handleReject = (id: string) => async () => {
    const { error } = await rejectSubgroup(id)
    if (error) toast.error(error)
    else toast.success("Rejeitado")
    refresh()
  }
  const handleReopen = (id: string) => async () => {
    const { error } = await reopenSubgroup(id)
    if (error) toast.error(error)
    else toast.success("Reaberto")
    refresh()
  }
  const handleDelete = (id: string) => async () => {
    if (!confirm("Deletar este sub-grupo? As atribuições pendentes dele são removidas e tags aplicadas ficam sem sub-grupo.")) return
    const { error } = await deleteSubgroup(id)
    if (error) toast.error(error)
    else toast.success("Sub-grupo deletado")
    refresh()
  }
  const handleSaveEdit = (id: string, name: string, description: string) => async () => {
    const { error } = await editSubgroup(id, { name, description })
    if (error) toast.error(error)
    else toast.success("Salvo")
    refresh()
  }

  const visibleIds = subgroups.map((s) => s.id)
  const runBulk = async (status: SubgroupStatus) => {
    if (selectedIds.size === 0) return
    setIsBulkRunning(true)
    const { updated, error } = await bulkSetSubgroupStatus([...selectedIds], status)
    setIsBulkRunning(false)
    if (error) toast.error(error)
    else toast.success(`${updated} sub-grupo(s) atualizado(s)`)
    exitSelectionMode()
    refresh()
  }

  // ---- Phase 2 handlers ----
  const handleApply = async () => {
    if (!confirm("Aplicar as atribuições aprovadas? Grava o sub-grupo definitivo nas tags.")) return
    setIsApplying(true)
    try {
      const result = await applyApprovedAssignments(initialGroup ?? undefined)
      if (result.errors.length > 0) {
        toast.error(`Aplicadas ${result.applied}, falharam ${result.failed}. Veja console.`)
        console.error(result.errors)
      } else {
        toast.success(`${result.applied} atribuição(ões) aplicada(s).`)
      }
      refresh()
    } finally {
      setIsApplying(false)
    }
  }

  const approvedSubgroupOptions = subgroupsWithTags.map((s) => ({ id: s.id, name: s.name }))

  return (
    <div className="space-y-4">
      {/* Single controls line — group, phase toggle, status (define), and the
          selection/apply actions all stay on the same row. */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/65 bg-background/40 p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grupo</label>
          <Select
            value={initialGroup ?? "all"}
            onValueChange={(value) => {
              exitSelectionMode()
              updateQuery({ group: value })
            }}
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
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fase</span>
          <div className="flex gap-1 rounded-lg border border-border/65 bg-background/40 p-1">
            <button
              type="button"
              onClick={() => {
                exitSelectionMode()
                updateQuery({ phase: "define" })
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                phase === "define" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              1 · Definir sub-grupos
            </button>
            <button
              type="button"
              onClick={() => {
                exitSelectionMode()
                updateQuery({ phase: "assign" })
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                phase === "assign" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              2 · Atribuir tags
            </button>
          </div>
        </div>

        {phase === "define" && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            <div className="flex gap-1 rounded-lg border border-border/65 bg-background/40 p-1">
              {SUB_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    exitSelectionMode()
                    updateQuery({ status: s.value })
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    initialStatus === s.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Right-side actions — same row, swaps to bulk buttons in selection mode. */}
        <div className="ml-auto flex items-center gap-2">
          {phase === "define" && !selectionMode && (
            <>
              {initialGroup && (
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Novo sub-grupo
                </Button>
              )}
              {subgroups.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
                  Selecionar
                </Button>
              )}
            </>
          )}
          {phase === "define" && selectionMode && (
            <>
              <span className="mr-1 text-xs text-muted-foreground">{selectedIds.size} de {visibleIds.length}</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set(visibleIds))}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Todas
              </button>
              <Button size="sm" variant="default" disabled={selectedIds.size === 0 || isBulkRunning} onClick={() => runBulk("approved")}>
                <Check className="mr-1 h-3.5 w-3.5" /> Aprovar ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" disabled={selectedIds.size === 0 || isBulkRunning} onClick={() => runBulk("rejected")}>
                <X className="mr-1 h-3.5 w-3.5" /> Rejeitar ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" disabled={selectedIds.size === 0 || isBulkRunning} onClick={() => runBulk("pending")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir ({selectedIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={exitSelectionMode} disabled={isBulkRunning}>
                Sair
              </Button>
            </>
          )}
          {phase === "assign" && initialGroup && subgroupsWithTags.length > 0 && (
            <Button variant="default" size="sm" onClick={handleApply} disabled={isApplying || isPending}>
              {isApplying ? "Aplicando…" : "Aplicar aprovados"}
            </Button>
          )}
        </div>
      </div>

      {phase === "define" ? (
        <DefinePhase
          subgroups={subgroups}
          initialGroup={initialGroup}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelected}
          onApprove={handleApprove}
          onReject={handleReject}
          onReopen={handleReopen}
          onDelete={handleDelete}
          onSaveEdit={handleSaveEdit}
          isPending={isPending}
        />
      ) : (
        <AssignPhase
          key={initialGroup ?? "none"}
          initialGroup={initialGroup}
          subgroupsWithTags={subgroupsWithTags}
          unassignedTags={unassignedTags}
          siblings={approvedSubgroupOptions}
          groups={groups}
          isPending={isPending}
          onRefresh={refresh}
        />
      )}

      {createOpen && initialGroup && (
        <CreateSubgroupDialog
          groupSlug={initialGroup}
          onClose={() => setCreateOpen(false)}
          onCreated={refresh}
        />
      )}
    </div>
  )
}

// ============================================================
// Phase 1 — define sub-groups
// ============================================================

interface DefinePhaseProps {
  subgroups: Subgroup[]
  initialGroup: TagGroupSlug | null
  selectionMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onApprove: (id: string) => () => void
  onReject: (id: string) => () => void
  onReopen: (id: string) => () => void
  onDelete: (id: string) => () => void
  onSaveEdit: (id: string, name: string, description: string) => () => void
  isPending: boolean
}

function DefinePhase({
  subgroups,
  initialGroup,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onApprove,
  onReject,
  onReopen,
  onDelete,
  onSaveEdit,
  isPending,
}: DefinePhaseProps) {
  if (subgroups.length === 0) {
    return (
      <div className="rounded-lg border border-border/65 bg-background/40 p-4 text-sm text-muted-foreground">
        Nenhum sub-grupo neste filtro. Rode{" "}
        <code className="rounded bg-muted/40 px-1 py-0.5">
          node scripts/propose-subgroups.js --group {initialGroup ?? "<slug>"}
        </code>{" "}
        para gerar propostas.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{subgroups.length} sub-grupo(s)</div>
      {subgroups.map((s) => (
        <SubgroupCard
          key={s.id}
          subgroup={s}
          selectionMode={selectionMode}
          isSelected={selectedIds.has(s.id)}
          onToggleSelect={() => onToggleSelect(s.id)}
          onApprove={onApprove(s.id)}
          onReject={onReject(s.id)}
          onReopen={onReopen(s.id)}
          onDelete={onDelete(s.id)}
          onSaveEdit={(name, description) => onSaveEdit(s.id, name, description)()}
          isPending={isPending}
        />
      ))}
    </div>
  )
}

interface SubgroupCardProps {
  subgroup: Subgroup
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onApprove: () => void
  onReject: () => void
  onReopen: () => void
  onDelete: () => void
  onSaveEdit: (name: string, description: string) => void
  isPending: boolean
}

function SubgroupCard({
  subgroup: s,
  selectionMode,
  isSelected,
  onToggleSelect,
  onApprove,
  onReject,
  onReopen,
  onDelete,
  onSaveEdit,
  isPending,
}: SubgroupCardProps) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(s.name)
  const [draftDesc, setDraftDesc] = useState(s.description ?? "")
  const [showRationale, setShowRationale] = useState(false)

  const sb = STATUS_BADGE[s.status]
  const confidencePct = s.confidence != null ? Math.round(s.confidence * 100) : null
  const isSelectable = selectionMode

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
              onCheckedChange={() => onToggleSelect()}
              onClick={(e) => e.stopPropagation()}
              className="mt-1"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} onClick={(e) => e.stopPropagation()} className="h-8 max-w-xs" />
              ) : (
                <span className="text-base font-semibold">{s.name}</span>
              )}
              <span className="text-xs text-muted-foreground">{s.group_slug}</span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sb.cls}`}>
                {sb.label}
              </span>
              {confidencePct != null && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                    confidencePct >= 90 ? "bg-emerald-400/15 text-emerald-200" : confidencePct >= 80 ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200"
                  }`}
                >
                  {confidencePct}%
                </span>
              )}
            </div>
            {editing ? (
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                rows={2}
                placeholder="Descrição (o que entra neste sub-grupo)"
                className="mt-1 w-full rounded-md border border-border/65 bg-background px-2 py-1.5 text-xs"
              />
            ) : (
              s.description && <p className="text-xs text-muted-foreground">{s.description}</p>
            )}
            <div className="text-xs text-muted-foreground">
              slug: <code className="rounded bg-muted/40 px-1 py-0.5">{s.slug}</code>
            </div>
          </div>
        </div>

        {!selectionMode && (
          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <Button size="sm" variant="default" disabled={isPending || !draftName.trim()} onClick={() => { onSaveEdit(draftName.trim(), draftDesc); setEditing(false) }}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraftName(s.name); setDraftDesc(s.description ?? ""); setEditing(false) }}>
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={isPending} title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {s.status === "pending" && (
                  <>
                    <Button size="sm" variant="default" onClick={onApprove} disabled={isPending} title="Aprovar">
                      <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending} title="Rejeitar">
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                  </>
                )}
                {s.status === "approved" && (
                  <>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending} title="Rejeitar">
                      <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending} title="Reabrir">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {s.status === "rejected" && (
                  <Button size="sm" variant="ghost" onClick={onReopen} disabled={isPending} title="Reabrir">
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={onDelete} disabled={isPending} title="Deletar sub-grupo" className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {s.rationale && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowRationale((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {showRationale ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Justificativa
          </button>
          {showRationale && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.rationale}</p>}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Phase 2 — assign tags
// ============================================================

interface AssignPhaseProps {
  initialGroup: TagGroupSlug | null
  subgroupsWithTags: SubgroupWithTags[]
  unassignedTags: UnassignedTag[]
  siblings: Array<{ id: string; name: string }>
  groups: Array<{ slug: TagGroupSlug; label: string }>
  isPending: boolean
  onRefresh: () => void
}

const CHIP_BY_STATUS: Record<AssignmentTag["status"], string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  approved: "border-primary/55 bg-primary/15 text-primary",
  applied: "border-sky-400/40 bg-sky-400/10 text-sky-100",
  rejected: "border-border bg-background text-muted-foreground",
}

function AssignPhase({ initialGroup, subgroupsWithTags, unassignedTags, siblings, groups, isPending, onRefresh }: AssignPhaseProps) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const exitSelection = () => {
    setSelectionMode(false)
    setSelected(new Set())
  }

  if (!initialGroup) {
    return (
      <div className="rounded-lg border border-border/65 bg-background/40 p-4 text-sm text-muted-foreground">
        Selecione um grupo para atribuir tags aos seus sub-grupos.
      </div>
    )
  }
  const hasSubgroups = subgroupsWithTags.length > 0
  if (!hasSubgroups && unassignedTags.length === 0) {
    return (
      <div className="rounded-lg border border-border/65 bg-background/40 p-4 text-sm text-muted-foreground">
        Este grupo não tem sub-grupos nem tags. Crie sub-grupos na fase <strong>Definir</strong>.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/65 bg-background/40 p-2.5">
        {selectionMode ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{selected.size} selecionada{selected.size === 1 ? "" : "s"}</span>
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                Limpar
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Selecione várias tags para movê-las de uma vez entre sub-grupos ou grupos.</span>
        )}
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <>
              <BulkMoveButton
                selectedIds={[...selected]}
                siblings={siblings}
                groups={groups}
                groupSlug={initialGroup}
                onMoved={() => {
                  exitSelection()
                  onRefresh()
                }}
              />
              <Button size="sm" variant="ghost" onClick={exitSelection}>
                Sair
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
              Selecionar tags
            </Button>
          )}
        </div>
      </div>

      {!hasSubgroups && (
        <div className="rounded-lg border border-border/55 bg-background/30 p-3 text-xs text-muted-foreground">
          Este grupo não usa sub-grupos. Abaixo estão suas {unassignedTags.length} tags — dá pra movê-las para outro grupo (uma a uma, ou em massa pelo modo seleção). Para sub-dividir, crie sub-grupos na fase <strong>Definir</strong>.
        </div>
      )}

      {subgroupsWithTags.map((s) => (
        <SubgroupAssignmentCard
          key={s.id}
          subgroup={s}
          groupSlug={initialGroup}
          siblings={siblings.filter((sib) => sib.id !== s.id)}
          groups={groups}
          isPending={isPending}
          onRefresh={onRefresh}
          selectionMode={selectionMode}
          selected={selected}
          onToggleSelect={toggleSelect}
        />
      ))}
      <UnassignedSection
        tags={unassignedTags}
        groupSlug={initialGroup}
        siblings={siblings}
        groups={groups}
        isPending={isPending}
        onRefresh={onRefresh}
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={toggleSelect}
        defaultOpen={!hasSubgroups}
        label={hasSubgroups ? "Outras tags do grupo" : "Tags do grupo"}
        hint={hasSubgroups ? "não atribuídas a nenhum sub-grupo" : "este grupo não usa sub-grupos"}
      />
    </div>
  )
}

function BulkMoveButton({
  selectedIds,
  siblings,
  groups,
  groupSlug,
  onMoved,
}: {
  selectedIds: string[]
  siblings: Array<{ id: string; name: string }>
  groups: Array<{ slug: TagGroupSlug; label: string }>
  groupSlug: string
  onMoved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const toSub = async (subgroupId: string) => {
    setBusy(true)
    const { moved, error } = await moveTagsToSubgroup(selectedIds, subgroupId, groupSlug)
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(`${moved} tag(s) movida(s)`)
      setOpen(false)
      onMoved()
    }
  }
  const toGroup = async (slug: string) => {
    setBusy(true)
    const { moved, error } = await moveTagsToOtherGroup(selectedIds, slug)
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(`${moved} tag(s) movida(s) para ${slug}`)
      setOpen(false)
      onMoved()
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="default" disabled={selectedIds.length === 0 || busy}>
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Mover {selectedIds.length} para…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sub-grupo (deste grupo)
        </div>
        <div className="max-h-44 overflow-y-auto">
          {siblings.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem sub-grupos aprovados.</div>
          ) : (
            siblings.map((sib) => (
              <button
                key={sib.id}
                type="button"
                disabled={busy}
                onClick={() => toSub(sib.id)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="truncate">{sib.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Outro grupo
        </div>
        <div className="max-h-44 overflow-y-auto">
          {groups
            .filter((g) => g.slug !== groupSlug)
            .map((g) => (
              <button
                key={g.slug}
                type="button"
                disabled={busy}
                onClick={() => toGroup(g.slug)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="truncate">{g.label}</span>
                <span className="text-[11px] text-muted-foreground">{g.slug}</span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface SubgroupAssignmentCardProps {
  subgroup: SubgroupWithTags
  groupSlug: string
  siblings: Array<{ id: string; name: string }>
  groups: Array<{ slug: TagGroupSlug; label: string }>
  isPending: boolean
  onRefresh: () => void
  selectionMode: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
}

function SubgroupAssignmentCard({ subgroup: s, groupSlug, siblings, groups, isPending, onRefresh, selectionMode, selected, onToggleSelect }: SubgroupAssignmentCardProps) {
  const [busy, setBusy] = useState(false)
  const pendingIds = s.tags.filter((t) => t.status === "pending").map((t) => t.assignmentId)

  const approvePending = async () => {
    if (pendingIds.length === 0) return
    setBusy(true)
    const { updated, error } = await bulkSetAssignmentStatus(pendingIds, "approved")
    setBusy(false)
    if (error) toast.error(error)
    else toast.success(`${updated} tag(s) aprovada(s)`)
    onRefresh()
  }

  return (
    <div className="rounded-lg border border-border/65 bg-background/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{s.name}</span>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{s.tags.length}</span>
        </div>
        {pendingIds.length > 0 && (
          <Button size="sm" variant="outline" disabled={busy || isPending} onClick={approvePending}>
            <Check className="mr-1 h-3.5 w-3.5" /> Aprovar pendentes ({pendingIds.length})
          </Button>
        )}
      </div>
      {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nenhuma tag atribuída.</span>
        ) : (
          s.tags.map((t) => (
            <AssignChip
              key={t.tagId}
              tagId={t.tagId}
              name={t.name}
              slug={t.slug}
              status={t.status}
              groupSlug={groupSlug}
              siblings={siblings}
              groups={groups}
              disabled={isPending}
              onChanged={onRefresh}
              selectionMode={selectionMode}
              selected={selected.has(t.tagId)}
              onToggleSelect={() => onToggleSelect(t.tagId)}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface UnassignedSectionProps {
  tags: UnassignedTag[]
  groupSlug: string
  siblings: Array<{ id: string; name: string }>
  groups: Array<{ slug: TagGroupSlug; label: string }>
  isPending: boolean
  onRefresh: () => void
  selectionMode: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
  defaultOpen?: boolean
  label?: string
  hint?: string
}

function UnassignedSection({ tags, groupSlug, siblings, groups, isPending, onRefresh, selectionMode, selected, onToggleSelect, defaultOpen = false, label = "Outras tags do grupo", hint = "não atribuídas a nenhum sub-grupo" }: UnassignedSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  // Always show while selecting so these tags are reachable for bulk move.
  const expanded = open || selectionMode
  if (tags.length === 0) return null
  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="text-sm font-semibold">{label}</span>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tags.length}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </button>
      {expanded && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <AssignChip
              key={t.id}
              tagId={t.id}
              name={t.name}
              slug={t.slug}
              status={null}
              groupSlug={groupSlug}
              siblings={siblings}
              groups={groups}
              disabled={isPending}
              onChanged={onRefresh}
              selectionMode={selectionMode}
              selected={selected.has(t.id)}
              onToggleSelect={() => onToggleSelect(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface AssignChipProps {
  tagId: string
  name: string
  slug: string
  status: AssignmentTag["status"] | null
  groupSlug: string
  siblings: Array<{ id: string; name: string }>
  groups: Array<{ slug: TagGroupSlug; label: string }>
  disabled: boolean
  onChanged: () => void
  selectionMode: boolean
  selected: boolean
  onToggleSelect: () => void
}

function AssignChip({ tagId, name, slug, status, groupSlug, siblings, groups, disabled, onChanged, selectionMode, selected, onToggleSelect }: AssignChipProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const move = async (subgroupId: string) => {
    setBusy(true)
    const { error } = await moveTagToSubgroup(tagId, subgroupId, groupSlug)
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(`"${name}" movida`)
      setOpen(false)
      onChanged()
    }
  }
  const moveGroup = async (targetSlug: string) => {
    setBusy(true)
    const { error } = await moveTagToOtherGroup(tagId, targetSlug)
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(`"${name}" movida para ${targetSlug}`)
      setOpen(false)
      onChanged()
    }
  }
  const remove = async () => {
    setBusy(true)
    const { error } = await unassignTag(tagId)
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(`"${name}" removida do sub-grupo`)
      setOpen(false)
      onChanged()
    }
  }

  const chipCls = status ? CHIP_BY_STATUS[status] : "border-dashed border-border bg-background text-muted-foreground"

  // Selection mode: the chip becomes a multi-select toggle (no per-tag popover).
  if (selectionMode) {
    return (
      <button
        type="button"
        onClick={onToggleSelect}
        title={`slug: ${slug}`}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
          selected ? "border-primary bg-primary text-primary-foreground" : `${chipCls} hover:border-primary/55`
        }`}
      >
        {selected && <Check className="h-3 w-3" />}
        <span>{name}</span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`slug: ${slug} — clique para mover`}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/55 disabled:cursor-default disabled:opacity-60 ${chipCls}`}
        >
          <span>{name}</span>
          {!disabled && <ArrowRightLeft className="h-2.5 w-2.5 opacity-50" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {status ? "Mover para outro sub-grupo" : "Atribuir a um sub-grupo"}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {siblings.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem outros sub-grupos aprovados.</div>
          ) : (
            siblings.map((sib) => (
              <button
                key={sib.id}
                type="button"
                disabled={busy}
                onClick={() => move(sib.id)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="truncate">{sib.name}</span>
              </button>
            ))
          )}
        </div>
        {status && (
          <>
            <div className="my-1 border-t border-border/60" />
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover do sub-grupo
            </button>
          </>
        )}
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Mover para outro grupo
        </div>
        <div className="max-h-56 overflow-y-auto">
          {groups
            .filter((g) => g.slug !== groupSlug)
            .map((g) => (
              <button
                key={g.slug}
                type="button"
                disabled={busy}
                onClick={() => moveGroup(g.slug)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="truncate">{g.label}</span>
                <span className="text-[11px] text-muted-foreground">{g.slug}</span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ============================================================
// Manual sub-group creation dialog
// ============================================================

interface CreateSubgroupDialogProps {
  groupSlug: TagGroupSlug
  onClose: () => void
  onCreated: () => void
}

function CreateSubgroupDialog({ groupSlug, onClose, onCreated }: CreateSubgroupDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    const { error } = await createSubgroup({ group_slug: groupSlug, name: name.trim(), description })
    setSubmitting(false)
    if (error) {
      toast.error(error)
      return
    }
    toast.success("Sub-grupo criado")
    onClose()
    onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border border-border/65 bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Novo sub-grupo em {groupSlug}</h2>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Looks" autoFocus />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="O que entra neste sub-grupo (guia a atribuição)."
            className="w-full rounded-md border border-border/65 bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Criando..." : "Criar"}
          </Button>
        </div>
      </div>
    </div>
  )
}
