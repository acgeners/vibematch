"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { addListComment, deleteListComment } from "@/server/actions/lists"
import type { ListComment } from "@/server/queries/lists"

interface GroupCommentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
  listName: string
  comments: ListComment[]
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

export function GroupCommentsDialog({ open, onOpenChange, listId, listName, comments }: GroupCommentsDialogProps) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()

  // Mais recentes primeiro (o array é append-only na ordem de criação).
  const ordered = [...comments].reverse()

  function handleAdd() {
    const trimmed = text.trim()
    if (!trimmed) return
    startTransition(async () => {
      const res = await addListComment(listId, trimmed)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      setText("")
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteListComment(listId, id)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Comentários de “{listName}”</DialogTitle>
          <DialogDescription>
            Anotações do grupo — separado da descrição. Registre o raciocínio da comparação ao longo do tempo.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {ordered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum comentário ainda. Escreva o primeiro abaixo.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ordered.map((c) => (
                <li key={c.id} className="group/comment rounded-lg border bg-card/50 p-3">
                  <p className="whitespace-pre-wrap text-sm">{c.text}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{formatWhen(c.created_at)}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={pending}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/comment:opacity-100 disabled:opacity-40"
                      aria-label="Excluir comentário"
                      title="Excluir comentário"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <Textarea
            value={text}
            rows={2}
            maxLength={2000}
            placeholder="Escrever um comentário…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd()
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter pra enviar</span>
            <Button size="sm" onClick={handleAdd} disabled={pending || !text.trim()}>
              {pending ? "Salvando…" : "Adicionar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
