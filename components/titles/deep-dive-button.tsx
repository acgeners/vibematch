"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DeepDiveDrawer } from "./deep-dive-drawer"
import type { DeepDiveResultRow } from "@/lib/ai-recommendation/types"

interface DeepDiveButtonProps {
  workId: string
  workTitle: string
  lastDive: DeepDiveResultRow | null
  /** "cta" mostra um card explicativo; "compact" só botão. */
  variant?: "cta" | "compact"
}

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return "agora"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return "ontem"
  if (days < 30) return `há ${days} dias`
  return date.toLocaleDateString("pt-BR")
}

export function DeepDiveButton({
  workId,
  workTitle,
  lastDive,
  variant = "cta",
}: DeepDiveButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {variant === "cta" ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-violet-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Consultor IA — Deep Dive
            </p>
            <p className="text-xs text-muted-foreground">
              Análise profunda com extended thinking. Compara a obra com sua biblioteca,
              sintetiza reviews e dá veredito acionável (agora/guardar/evitar).
            </p>
            <p className="text-[10px] text-muted-foreground/80">
              ~$0.21/análise · 25-45s · cap diário de 10
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              onClick={() => setOpen(true)}
              variant="outline"
              className="border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
            >
              <Sparkles className="h-4 w-4" />
              {lastDive ? "Nova análise" : "Analisar"}
            </Button>
            {lastDive && (
              <Badge
                variant="outline"
                className="text-[10px] font-normal text-muted-foreground"
              >
                última: {timeAgo(lastDive.created_at)}
              </Badge>
            )}
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Deep Dive
        </Button>
      )}

      <DeepDiveDrawer
        workId={workId}
        workTitle={workTitle}
        open={open}
        onOpenChange={setOpen}
        initialDive={lastDive}
      />
    </>
  )
}
