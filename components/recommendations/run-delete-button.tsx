"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deleteRecommendationRunAction } from "@/server/actions/recommendations"

/** Botão de excluir a run, isolado pra ficar no canto superior direito (Header). */
export function RunDeleteButton({ runId }: { runId: string }) {
  const router = useRouter()
  const refresh = useRefresh()
  const [confirm, setConfirm] = useState(false)
  const [deleting, startDelete] = useTransition()

  const handleDelete = () => {
    startDelete(async () => {
      const res = await deleteRecommendationRunAction(runId)
      if (!res.ok && res.error) return
      router.push("/recommendations")
      refresh()
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirm(true)}
        disabled={deleting}
        className="text-destructive hover:text-destructive"
      >
        {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
        Excluir
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Excluir esta execução?"
        description="A run salva será removida do histórico. Esta ação não pode ser desfeita."
        confirmText="Excluir"
        onConfirm={handleDelete}
      />
    </>
  )
}
