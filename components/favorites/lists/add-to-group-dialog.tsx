"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Check, FolderPlus, Plus } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { addWorksToList, createWorkList } from "@/server/actions/lists"
import { GROUP_COLORS } from "@/components/favorites/lists/group-form-dialog"
import type { ListPickerOption } from "@/server/queries/lists"

interface AddToGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** IDs das obras selecionadas na tabela. */
  workIds: string[]
  /** Grupos de destino disponíveis (já sem o grupo atual, quando numa página de grupo). */
  groups: ListPickerOption[]
  /** Chamado após adicionar com sucesso (limpa a seleção + refresh na tabela). */
  onDone: () => void
}

export function AddToGroupDialog({
  open,
  onOpenChange,
  workIds,
  groups,
  onDone,
}: AddToGroupDialogProps) {
  const [pending, startTransition] = useTransition()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")

  const count = workIds.length

  // Reseta o estado na transição fechado→aberto (sem effect).
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setTargetId(null)
    setCreating(groups.length === 0)
    setNewName("")
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  function finish(listName: string) {
    toast.success(`${count} obra${count !== 1 ? "s" : ""} adicionada${count !== 1 ? "s" : ""} a “${listName}”.`)
    onOpenChange(false)
    onDone()
  }

  function handleConfirm() {
    if (count === 0) return
    startTransition(async () => {
      if (creating) {
        const name = newName.trim()
        if (!name) {
          toast.error("Dê um nome ao grupo.")
          return
        }
        const created = await createWorkList({ name, color: GROUP_COLORS[0] })
        if ("error" in created) {
          toast.error(created.error)
          return
        }
        const res = await addWorksToList(created.data.id, workIds)
        if ("error" in res) {
          toast.error(res.error)
          return
        }
        finish(name)
        return
      }

      if (!targetId) return
      const target = groups.find((g) => g.id === targetId)
      const res = await addWorksToList(targetId, workIds)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      finish(target?.name ?? "grupo")
    })
  }

  const canConfirm = creating ? newName.trim().length > 0 : targetId != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar a um grupo</DialogTitle>
          <DialogDescription>
            {count} obra{count !== 1 ? "s" : ""} selecionada{count !== 1 ? "s" : ""}. Escolha o grupo
            de destino — elas continuam nos favoritos.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <ul className="flex flex-col gap-0.5">
            {groups.map((g) => {
              const checked = targetId === g.id && !creating
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setTargetId(g.id)
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60",
                      checked && "bg-accent/40",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: g.color ? `hsl(${g.color})` : "hsl(var(--muted-foreground))" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{g.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {g.count} obra{g.count !== 1 ? "s" : ""}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Criar um grupo novo já com as obras selecionadas. */}
          <div className="mt-1 border-t pt-1">
            {creating ? (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  autoFocus
                  value={newName}
                  placeholder="Nome do novo grupo…"
                  maxLength={80}
                  className="h-8"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canConfirm && !pending) handleConfirm()
                  }}
                />
                {groups.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => {
                      setCreating(false)
                      setNewName("")
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setTargetId(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <Plus className="size-4 shrink-0" />
                Criar novo grupo…
              </button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || pending}>
            {pending ? "Adicionando…" : creating ? "Criar e adicionar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
