"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { createGroupFromProposal, proposeFavoriteGroups } from "@/server/actions/lists"
import { ScopedTaskStrip, useScopedGuard } from "@/components/tasks/scoped-task"
import type { WorkLiteForPicker } from "@/server/queries/lists"

interface SuggestGroupsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Catálogo lite (todas as obras) pra renderizar capa/título das propostas. */
  catalog: WorkLiteForPicker[]
}

/** Estado editável de uma proposta da IA (nome/descrição/seleção de obras). */
interface ProposalVM {
  name: string
  description: string
  workIds: string[]
  selected: Set<string>
  createdId: string | null
}

const COUNTS = [1, 2, 3, 4]

export function SuggestGroupsDialog({ open, onOpenChange, catalog }: SuggestGroupsDialogProps) {
  const router = useRouter()
  const [n, setN] = useState(3)
  const [genPending, startGen] = useTransition()

  // Request-scoped: `proposeFavoriteGroups` só LÊ e devolve as propostas — nada é
  // gravado até você criar o grupo. Diálogo MODAL, então a porta de saída é
  // fechar (Cancelar · Esc · clicar fora), não o link da barra: sem
  // `guardNavigation`. Ver components/tasks/scoped-task.tsx.
  const { guard, guardDialog, elapsed } = useScopedGuard({
    running: genPending,
    title: "Fechar agora perde as sugestões",
    what: "Gerar sugestões",
    confirmLabel: "Fechar mesmo assim",
  })
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null)
  const [, startCreate] = useTransition()
  const [proposals, setProposals] = useState<ProposalVM[] | null>(null)

  const byId = useMemo(() => new Map(catalog.map((w) => [w.id, w])), [catalog])

  // Reset na transição fechado→aberto (sem effect).
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setProposals(null)
    setN(3)
    setCreatingIdx(null)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  function handleGenerate() {
    startGen(async () => {
      const res = await proposeFavoriteGroups(n)
      if ("error" in res) {
        toast.error(res.error)
        setProposals([])
        return
      }
      setProposals(
        res.data.groups.map((g) => ({
          name: g.name,
          description: g.description,
          workIds: g.workIds,
          selected: new Set(g.workIds),
          createdId: null,
        })),
      )
    })
  }

  function patch(idx: number, partial: Partial<ProposalVM>) {
    setProposals((prev) => (prev ? prev.map((p, i) => (i === idx ? { ...p, ...partial } : p)) : prev))
  }

  function toggleMember(idx: number, id: string) {
    setProposals((prev) =>
      prev
        ? prev.map((p, i) => {
            if (i !== idx) return p
            const selected = new Set(p.selected)
            if (selected.has(id)) selected.delete(id)
            else selected.add(id)
            return { ...p, selected }
          })
        : prev,
    )
  }

  function handleCreate(idx: number) {
    const p = proposals?.[idx]
    if (!p) return
    if (!p.name.trim()) {
      toast.error("Dê um nome ao grupo.")
      return
    }
    if (p.selected.size < 1) {
      toast.error("Selecione ao menos 1 obra.")
      return
    }
    setCreatingIdx(idx)
    startCreate(async () => {
      const res = await createGroupFromProposal({
        name: p.name.trim(),
        description: p.description.trim() || null,
        workIds: [...p.selected],
      })
      setCreatingIdx(null)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      patch(idx, { createdId: res.data.id })
      toast.success(`Grupo “${p.name.trim()}” criado.`)
      router.refresh()
    })
  }

  const hasProposals = proposals != null && proposals.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : guard(() => onOpenChange(false)))}
    >
      {guardDialog}
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Sugerir grupos com IA
          </DialogTitle>
          <DialogDescription>
            A IA analisa seus favoritos e propõe grupos temáticos coesos. Revise nome, descrição e
            obras e crie os que quiser.
          </DialogDescription>
        </DialogHeader>

        {/* Controles */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Quantos grupos?</Label>
            <div className="flex gap-1">
              {COUNTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={n === c}
                  disabled={genPending}
                  onClick={() => setN(c)}
                  className={cn(
                    "size-8 rounded-md border text-sm tabular-nums transition-colors",
                    n === c
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleGenerate} disabled={genPending}>
            <Sparkles className={cn("size-4", genPending && "animate-pulse")} />
            {genPending ? "Analisando…" : hasProposals ? "Gerar de novo" : "Gerar sugestões"}
          </Button>
        </div>

        <ScopedTaskStrip
          running={genPending}
          elapsed={elapsed}
          label="Analisando seus favoritos…"
          note="Fique neste diálogo. As sugestões aparecem aqui e não ficam salvas — só ao criar o grupo elas viram dado."
          className="mb-3"
        />

        {/* Corpo */}
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {proposals == null ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Escolha quantos grupos quer e toque em <span className="font-medium">Gerar sugestões</span>.
            </p>
          ) : proposals.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma sugestão. Tente de novo ou com mais favoritos.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {proposals.map((p, idx) => {
                const created = p.createdId != null
                return (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-lg border bg-card/50 p-3",
                      created && "border-emerald-500/40 bg-emerald-500/5",
                    )}
                  >
                    <div className="flex flex-col gap-2">
                      <Input
                        value={p.name}
                        maxLength={80}
                        disabled={created}
                        aria-label="Nome do grupo"
                        className="font-semibold"
                        onChange={(e) => patch(idx, { name: e.target.value })}
                      />
                      <Textarea
                        value={p.description}
                        rows={2}
                        maxLength={500}
                        disabled={created}
                        aria-label="Descrição do grupo"
                        className="text-sm"
                        onChange={(e) => patch(idx, { description: e.target.value })}
                      />
                    </div>

                    <ul className="mt-2 flex flex-col">
                      {p.workIds.map((id) => {
                        const w = byId.get(id)
                        if (!w) return null
                        const checked = p.selected.has(id)
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              disabled={created}
                              onClick={() => toggleMember(idx, id)}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/60 disabled:opacity-70 disabled:hover:bg-transparent",
                              )}
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                                  checked
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input",
                                )}
                              >
                                {checked && <Check className="size-3" />}
                              </span>
                              <CoverImage
                                urls={w.coverUrls}
                                alt={w.title}
                                className="h-9 w-7 shrink-0 rounded object-cover"
                              />
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-sm",
                                  !checked && "text-muted-foreground line-through",
                                )}
                              >
                                {w.title}
                              </span>
                              {w.expectedScore != null && (
                                <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                  {w.expectedScore.toFixed(1)}
                                </span>
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {p.selected.size} de {p.workIds.length} obra{p.workIds.length !== 1 ? "s" : ""}
                      </span>
                      {created ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-emerald-500/40 text-emerald-500 hover:text-emerald-500"
                          onClick={() => router.push(`/favorites/${p.createdId}`)}
                        >
                          <Check className="size-4" /> Criado · abrir
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={creatingIdx === idx}
                          onClick={() => handleCreate(idx)}
                        >
                          {creatingIdx === idx ? "Criando…" : "Criar grupo"}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={genPending}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
