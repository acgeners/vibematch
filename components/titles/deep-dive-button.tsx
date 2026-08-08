"use client"

import { useState } from "react"
import { Sparkles, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { DeepDiveDrawer } from "./deep-dive-drawer"
import type { DeepDiveReadWhen, DeepDiveResultRow } from "@/lib/ai-recommendation/types"

interface DeepDiveButtonProps {
  workId: string
  workTitle: string
  lastDive: DeepDiveResultRow | null
  /** "cta" mostra um card explicativo; "compact" só botão. */
  variant?: "cta" | "compact"
  /** Deep Dive é exclusivo do Pago — quando false, mostra CTA de upgrade. */
  isPaid?: boolean
  /**
   * Permite criar uma NOVA análise. Quando false (ex.: obra Completed/Dropped),
   * o card vira só-leitura: esconde o botão de criar e o custo, mantendo apenas
   * "Ver análise" pra reabrir o deep dive salvo.
   */
  allowNew?: boolean
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

const READ_WHEN_META: Record<DeepDiveReadWhen, { label: string; cls: string }> = {
  agora: { label: "Ler agora", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  guardar: { label: "Guardar", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  evitar: { label: "Evitar", cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
}

export function DeepDiveButton({
  workId,
  workTitle,
  lastDive,
  variant = "cta",
  isPaid = true,
  allowNew = true,
}: DeepDiveButtonProps) {
  const [open, setOpen] = useState(false)
  const [startView, setStartView] = useState<"result" | "form">("result")

  const openView = () => {
    setStartView("result")
    setOpen(true)
  }
  const openNew = () => {
    setStartView("form")
    setOpen(true)
  }

  const whenMeta = lastDive?.read_when ? READ_WHEN_META[lastDive.read_when] : null

  return (
    <>
      {variant === "cta" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-violet-500/5 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-0.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Consultor IA — Deep Dive
              </p>
              <p className="text-xs text-muted-foreground">
                Análise profunda com extended thinking. Compara a obra com sua biblioteca,
                sintetiza reviews e dá veredito acionável (agora/guardar/evitar).
              </p>
              {allowNew && (
                <p className="text-[11px] text-muted-foreground/80">
                  ~$0,21/análise · 25-45s · cap diário de 10
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {isPaid && lastDive && (
                <Button variant="outline" size="sm" onClick={openView} className="gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Ver análise
                </Button>
              )}
              {allowNew && (
                <Button
                  onClick={openNew}
                  disabled={!isPaid}
                  variant="outline"
                  className="border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
                >
                  <Sparkles className="h-4 w-4" />
                  {!isPaid ? "Plano Pago" : lastDive ? "Nova análise" : "Analisar"}
                </Button>
              )}
            </div>
          </div>

          {/* Resumo da última análise — peek clicável que abre o resultado salvo. */}
          {isPaid && lastDive && (
            <button
              type="button"
              onClick={openView}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-card/70"
            >
              {whenMeta && (
                <Badge variant="outline" className={cn("shrink-0 text-[11px] font-medium", whenMeta.cls)}>
                  {whenMeta.label}
                </Badge>
              )}
              {lastDive.match_score != null && (
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">
                  {Math.round(lastDive.match_score)}/100
                </span>
              )}
              {lastDive.one_liner && (
                <span className="min-w-0 flex-1 truncate text-xs italic text-muted-foreground">
                  &ldquo;{lastDive.one_liner}&rdquo;
                </span>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {timeAgo(lastDive.created_at)}
              </span>
            </button>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={lastDive ? openView : openNew}
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
        startView={startView}
      />
    </>
  )
}
