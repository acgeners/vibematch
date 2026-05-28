"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  deleteRecommendationRunAction,
  rerunRecommendationFromExistingAction,
} from "@/server/actions/recommendations"

interface RunDetailActionsProps {
  runId: string
}

export function RunDetailActions({ runId }: RunDetailActionsProps) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rerunning, startRerun] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRerun = () => {
    setError(null)
    startRerun(async () => {
      const res = await rerunRecommendationFromExistingAction(runId)
      if (res.error) setError(res.error)
      else if (res.data) {
        router.push(`/recommendations/${res.data.runSlug}`)
        router.refresh()
      }
    })
  }

  const handleDelete = () => {
    setError(null)
    startDelete(async () => {
      const res = await deleteRecommendationRunAction(runId)
      if (!res.ok && res.error) {
        setError(res.error)
        return
      }
      router.push("/recommendations")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleRerun} disabled={rerunning || deleting}>
          {rerunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Rodar de novo com mesmo contexto
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmDelete(true)}
          disabled={rerunning || deleting}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          Excluir
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir esta execução?"
        description="A run salva será removida do histórico. Esta ação não pode ser desfeita."
        confirmText="Excluir"
        onConfirm={handleDelete}
      />
    </div>
  )
}
