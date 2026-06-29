"use client"

import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { useState, useTransition } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { rerunRecommendationFromExistingAction } from "@/server/actions/recommendations"

interface RunDetailActionsProps {
  runId: string
}

export function RunDetailActions({ runId }: RunDetailActionsProps) {
  const router = useRouter()
  const refresh = useRefresh()
  const [rerunning, startRerun] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRerun = () => {
    setError(null)
    startRerun(async () => {
      const res = await rerunRecommendationFromExistingAction(runId)
      if (res.error) setError(res.error)
      else if (res.data) {
        router.push(`/recommendations/${res.data.runSlug}`)
        refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col items-center gap-1">
        <Button size="sm" onClick={handleRerun} disabled={rerunning} className="w-full sm:w-auto px-4">
          {rerunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Rodar novamente
        </Button>
        <span className="text-[10px] font-semibold text-muted-foreground/75 tracking-wide select-none">
          com mesmo contexto
        </span>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
