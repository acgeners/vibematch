"use client"

import { useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { triggerRecalcNow, getAiPendingCounts } from "@/server/actions/recalc-queue"
import type { AiPendingCounts } from "@/server/actions/recalc-queue"
import { AiPendingGuardDialog } from "@/components/settings/ai-pending-guard-dialog"
import type { AiPendingItem } from "@/components/settings/ai-pending-guard-dialog"

interface RecalcPendingControlProps {
  /** Estado vindo do server (banner) ou do fetch de badges (sidebar). */
  pending: boolean
  /** "banner" = faixa âmbar; "compact" = botão na sidebar; "indicator" = ícone de
   *  atenção clicável (hover→tooltip, clique→recalcula) ao lado do título do /ranking. */
  variant?: "banner" | "compact" | "indicator"
  /** Callback opcional pra o pai sincronizar o estado após o recálculo. */
  onDone?: () => void
}

/** Monta a lista de pendências de IA (só as com count > 0), com links pro /settings. */
function buildAiPendingItems(counts: AiPendingCounts): AiPendingItem[] {
  return [
    { label: "Embeddings", count: counts.embeddings, href: "/settings?g=ia#card-embeddings" },
    { label: "Sinopse canônica", count: counts.canonicalSynopsis, href: "/settings?g=ia#card-synopsis-canonical" },
    { label: "Resumo de reviews", count: counts.reviewSummary, href: "/settings?g=ia#card-review-synthesis" },
  ].filter((i) => i.count > 0)
}

/**
 * Botão "Recalcular agora" da fila de recálculo. Aparece quando há edições de
 * nota não recalculadas (recalc_pending). Roda recalculateAll na hora; some ao
 * concluir. O recálculo automático (até 1h após a última edição) é independente
 * deste botão — aqui é só o atalho manual.
 *
 * Trava: antes de recalcular, checa se há artefatos gerados por IA pendentes
 * (embeddings, sinopse canônica, resumo). Se houver, abre um aviso pro usuário
 * decidir seguir mesmo assim ou resolver antes — mesma regra da calibração.
 */
export function RecalcPendingControl({
  pending,
  variant = "banner",
  onDone,
}: RecalcPendingControlProps) {
  const refresh = useRefresh()
  const [running, setRunning] = useState(false)
  const [checking, setChecking] = useState(false)
  const [done, setDone] = useState(false)
  const [showGuard, setShowGuard] = useState(false)
  const [pendingItems, setPendingItems] = useState<AiPendingItem[]>([])

  if (!pending || done) return null

  const busy = running || checking

  const handleRecalc = async () => {
    setRunning(true)
    try {
      const res = await triggerRecalcNow()
      if (res.status === "succeeded") {
        toast.success(`Notas recalculadas (${res.recalculated} obra${res.recalculated === 1 ? "" : "s"}).`)
        setDone(true)
        onDone?.()
        refresh()
      } else if (res.status === "fresh") {
        toast.success("As notas já estão atualizadas.")
        setDone(true)
        onDone?.()
      } else if (res.status === "processing") {
        toast.info("Recálculo em andamento.")
        refresh()
      } else {
        // failed — mantém o botão para retry explícito.
        toast.error("O recálculo falhou. Tente novamente.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao recalcular")
    } finally {
      setRunning(false)
    }
  }

  // Clique no botão: checa pendências de IA antes; se houver, avisa; senão recalcula.
  const handleClick = async () => {
    setChecking(true)
    try {
      const items = buildAiPendingItems(await getAiPendingCounts())
      if (items.length > 0) {
        setPendingItems(items)
        setShowGuard(true)
        return
      }
      await handleRecalc()
    } catch {
      // Se a checagem falhar, não trava o fluxo — recalcula direto.
      await handleRecalc()
    } finally {
      setChecking(false)
    }
  }

  const guard = (
    <AiPendingGuardDialog
      open={showGuard}
      onOpenChange={setShowGuard}
      items={pendingItems}
      onProceed={handleRecalc}
      description="O recálculo das notas usa esses artefatos gerados por IA como sinal (o kNN dos embeddings, entre outros). Recalcular agora usa dados possivelmente desatualizados — a Nota Prevista e o ranking podem sair piores. Resolva as pendências primeiro ou siga mesmo assim."
      proceedLabel="Recalcular mesmo assim"
    />
  )

  // Ícone de atenção ao lado do título do /ranking (substitui a faixa): hover mostra
  // o texto do aviso, clique dispara o recálculo (mesma trava de IA do banner).
  if (variant === "indicator") {
    return (
      <>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleClick}
                disabled={busy}
                aria-label="Notas alteradas — recálculo pendente. Clique para recalcular."
                className="relative inline-grid size-8 shrink-0 place-items-center rounded-lg border border-amber-500/40 bg-amber-400/10 text-amber-600 transition-colors hover:bg-amber-400/20 disabled:opacity-70 dark:text-amber-400"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs text-left">
              <span className="font-semibold">Notas alteradas — recálculo pendente</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                A Nota Prevista e o ranking ainda não refletem suas últimas edições.
                Clique para recalcular agora ou aguarde o recálculo automático (até 1h
                após a última alteração).
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {guard}
      </>
    )
  }

  if (variant === "compact") {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClick}
          disabled={busy}
          className="w-full gap-2 border-amber-500/50 text-amber-600 dark:text-amber-400"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {running ? "Recalculando…" : "Recalcular notas"}
        </Button>
        {guard}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">Notas alteradas — recálculo pendente</p>
        <p className="text-sm text-amber-900/80 dark:text-amber-100/70">
          A Nota Prevista e o ranking ainda não refletem suas últimas edições.
          Recalcule agora ou aguarde o recálculo automático (até 1h após a última
          alteração).
        </p>
      </div>
      <Button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="w-full gap-2 sm:w-auto"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {running ? "Recalculando…" : "Recalcular agora"}
      </Button>
      {guard}
    </div>
  )
}
