"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/ui/save-button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { createWorkList, updateWorkList } from "@/server/actions/lists"
import type { WorkLiteForPicker } from "@/server/queries/lists"

export const GROUP_COLORS = [
  "200 98% 72%",
  "348 78% 66%",
  "150 55% 55%",
  "42 88% 62%",
  "283 63% 70%",
]

export interface GroupFormData {
  id: string
  name: string
  description: string | null
  color: string | null
  coverWorkIds: string[]
}

interface GroupFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  list?: GroupFormData
  /** Obras do grupo, candidatas a virar capa (só no modo edição). */
  coverCandidates?: WorkLiteForPicker[]
}

export function GroupFormDialog({ open, onOpenChange, mode, list, coverCandidates = [] }: GroupFormDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [coverIds, setCoverIds] = useState<string[]>([])

  // Reidrata os campos na transição fechado→aberto (padrão "adjust state during
  // render", sem effect — evita render em cascata).
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setName(list?.name ?? "")
    setDescription(list?.description ?? "")
    setColor(list?.color ?? GROUP_COLORS[0])
    setCoverIds(list?.coverWorkIds ?? [])
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  // Criar: basta um nome válido. Editar: só habilita quando algum campo difere
  // do grupo atual (a ordem das capas importa — vira o número do selo).
  const trimmedName = name.trim()
  const dirty = useMemo(() => {
    if (mode === "create") return trimmedName.length > 0
    if (!list) return false
    if (trimmedName !== (list.name ?? "")) return true
    if (description !== (list.description ?? "")) return true
    if (color !== (list.color ?? GROUP_COLORS[0])) return true
    const base = list.coverWorkIds ?? []
    if (coverIds.length !== base.length) return true
    return coverIds.some((id, i) => id !== base[i])
  }, [mode, list, trimmedName, description, color, coverIds])

  function toggleCover(id: string) {
    setCoverIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
  }

  function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Dê um nome ao grupo.")
      return
    }
    // Enter no modo edição sem nenhuma mudança não deve gravar um no-op.
    if (!dirty) return
    startTransition(async () => {
      const payload = { name: trimmed, description, color, coverWorkIds: coverIds }
      const res =
        mode === "create"
          ? await createWorkList(payload)
          : await updateWorkList(list!.id, payload)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      toast.success(mode === "create" ? "Grupo criado." : "Grupo atualizado.")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* flex + max-h: mesmo padrão dos outros dialogs de favoritos (manage-works,
          add-to-group) — header e footer fixos, só o miolo rola. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo grupo" : "Editar grupo"}</DialogTitle>
          <DialogDescription>
            Um grupo é um recorte dos seus favoritos pra comparar em um contexto específico.
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0: sem isso o min-content da fileira de capas (N × 42px) infla a
            coluna do dialog e o conteúdo sangra pra fora do painel. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">Nome</Label>
            <Input
              id="group-name"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="Ex.: Comparar romantasy"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit()
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-desc">
              Descrição <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="group-desc"
              value={description}
              rows={2}
              maxLength={500}
              placeholder="Pra que serve esse grupo?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Cor</Label>
            <div className="flex gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-7 rounded-md border-2 transition-transform hover:scale-105",
                    color === c ? "border-foreground" : "border-transparent",
                  )}
                  style={{ background: `hsl(${c})` }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Capa do grupo</Label>
            {coverCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {mode === "create"
                  ? "Você poderá escolher as capas depois de adicionar obras ao grupo."
                  : "Adicione obras ao grupo pra escolher as capas. Por ora usamos as de maior Nota Prevista."}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Escolha até 3 obras. Sem escolha, usamos as de maior Nota Prevista.
                </p>
                {/* Quebra em linhas (em vez de fileira única): um grupo com 50 obras
                    gerava 50 miniaturas numa linha só. O pt/pr dá folga pro selo de
                    posição, que é absolute e sai da caixa da miniatura. */}
                <div className="flex max-h-[136px] flex-wrap gap-2 overflow-y-auto pb-1 pr-1.5 pt-1.5">
                  {coverCandidates.map((w) => {
                    const idx = coverIds.indexOf(w.id)
                    const selected = idx >= 0
                    return (
                      <button
                        key={w.id}
                        type="button"
                        title={w.title}
                        onClick={() => toggleCover(w.id)}
                        className={cn(
                          "relative h-[58px] w-[42px] shrink-0 overflow-hidden rounded-md border-2 transition-opacity",
                          selected ? "border-primary opacity-100" : "border-transparent opacity-50 hover:opacity-90",
                        )}
                      >
                        <CoverImage url={w.coverUrl} alt={w.title} className="h-full w-full object-cover" />
                        {selected && (
                          <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {idx + 1}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <SaveButton
            onClick={handleSubmit}
            disabled={pending || !dirty}
            disabledReason={
              !dirty
                ? mode === "create"
                  ? "Dê um nome ao grupo"
                  : "Nenhuma alteração para salvar"
                : undefined
            }
          >
            {pending ? "Salvando…" : mode === "create" ? "Criar grupo" : "Salvar"}
          </SaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
