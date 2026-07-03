"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { recommendGroup } from "@/server/actions/lists"

interface GroupRecommendButtonProps {
  listId: string
  workCount: number
  isPaid: boolean
}

// Reusa o fluxo de "Recomendar com IA" (runTask global + run navegável em
// /recommendations), mas escopado às obras do grupo via recommendGroup, que
// carimba o list_id no run. É o "desempate com IA" do grupo.
export function GroupRecommendButton({ listId, workCount, isPaid }: GroupRecommendButtonProps) {
  const router = useRouter()
  const refresh = useRefresh()
  const [open, setOpen] = useState(false)
  const [userContext, setUserContext] = useState("")
  const tasks = useAppTasks()
  const isPending = tasks.some((t) => t.id === "recommend" && t.status === "running")

  if (!isPaid) {
    return (
      <Button
        variant="default"
        size="sm"
        className="gap-1.5"
        disabled
        title="Recomendação por IA é uma feature do plano Pago."
      >
        <Sparkles className="h-3.5 w-3.5" />
        Recomendar com IA
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  if (workCount < 2) {
    return (
      <Button variant="default" size="sm" className="gap-1.5" disabled title="Adicione ao menos 2 obras ao grupo.">
        <Sparkles className="h-3.5 w-3.5" />
        Recomendar com IA
      </Button>
    )
  }

  function handleConfirm() {
    setOpen(false)
    runTask({
      id: "recommend",
      kind: "recommend",
      label: "Desempatando o grupo com IA",
      run: () => recommendGroup(listId, { userContext: userContext.trim() || null }),
      successToast: (result) =>
        "data" in result
          ? {
              message: "Recomendação do grupo pronta",
              action: { label: "Ver", href: `/recommendations/${result.data.slug}` },
            }
          : null,
      onDone: (result) => {
        if ("error" in result) {
          toast.error(result.error)
          return
        }
        router.push(`/recommendations/${result.data.slug}`)
        refresh()
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao recomendar"),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-1.5" disabled={isPending}>
          <Sparkles className="h-3.5 w-3.5" />
          Recomendar com IA
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recomendar / desempatar o grupo</DialogTitle>
          <DialogDescription>
            A IA rankeia as {workCount} obras deste grupo por Veredito IA. O resultado fica salvo em
            /recommendations e atrelado ao grupo. Cada execução chama a Claude API (limite diário).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="group-rec-context" className="text-xs uppercase tracking-wide text-muted-foreground">
            Contexto / mood <span className="normal-case">(opcional)</span>
          </Label>
          <Textarea
            id="group-rec-context"
            value={userContext}
            rows={2}
            maxLength={500}
            placeholder="Ex.: quero algo leve pra maratonar no fim de semana"
            onChange={(e) => setUserContext(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isPending} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Recomendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
