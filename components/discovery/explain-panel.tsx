"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Sparkles, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatUsdApprox } from "@/lib/format/money"
import { EXPLAIN_COST_USD } from "@/lib/discovery/limits"
import { ScopedTaskStrip, useScopedGuard } from "@/components/tasks/scoped-task"
import {
  explainSeedResultsAction,
  applySeedVerdictAction,
} from "@/server/actions/recommendations"
import type { ExplainSeedsResult } from "@/server/actions/recommendations"

/**
 * "Explicar" e, só depois, "Aplicar ao catálogo".
 *
 * 🔴 Faixa ÂMBAR (request-scoped), não o store azul. A régua é uma pergunta só: *o resultado
 * sobrevive se a pessoa sair da tela?* Aqui não — a explicação vive nesta tela até ela
 * decidir aplicá-la. Pôr no azul convidaria a navegar e jogar fora o que custou ~6,4¢.
 *
 * ⚠️ `guardNavigation: true` porque esta ação é SOLTA na página. Não há modal, então o
 * scrim não existe e a porta de saída é o link da barra superior — se ninguém interceptar,
 * um clique distraído descarta o resultado pago.
 *
 * 🔴 Aplicar manda o `runId`, NUNCA as notas. A action é um endpoint HTTP público; aceitar
 * `alignment_score` do cliente deixaria qualquer um escrever o Veredito que quisesse.
 */

interface Props {
  seedIds: string[]
  antiIds: string[]
  /**
   * As obras a explicar, COM título.
   *
   * ⚠️ Não basta o id: sem o título, a explicação vira uma lista de parágrafos soltos e a
   * pessoa tem que casar cada um com a lista acima de cabeça. Medido na tela — foi o
   * primeiro problema visível depois da execução real.
   */
  works: Array<{ id: string; title: string }>
  weight: number
}

export function ExplainPanel({ seedIds, antiIds, works, weight }: Props) {
  const workIds = works.map((w) => w.id)
  const count = works.length
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ExplainSeedsResult | null>(null)
  const [applied, setApplied] = useState(false)

  const { guard, guardDialog, elapsed } = useScopedGuard({
    running,
    title: "Sair agora perde a explicação",
    what: "Explicar com IA",
    confirmLabel: "Sair mesmo assim",
    guardNavigation: true,
  })

  async function explicar() {
    setRunning(true)
    setResult(null)
    setApplied(false)
    try {
      const res = await explainSeedResultsAction({ seedIds, antiIds, workIds, weight })
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.data) setResult(res.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível explicar.")
    } finally {
      setRunning(false)
    }
  }

  async function aplicar() {
    if (!result) return
    setApplying(true)
    try {
      const res = await applySeedVerdictAction(result.runId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setApplied(true)
      toast.success(
        `Veredito aplicado a ${res.data?.applied ?? 0} obra(s) — agora aparece no /ranking também.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível aplicar.")
    } finally {
      setApplying(false)
    }
  }

  const byWork = new Map(result?.rankings.map((r) => [r.workId, r]) ?? [])

  return (
    <div className="flex flex-col gap-3">
      {guardDialog}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={running || workIds.length === 0}
          onClick={() => guard(explicar)}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          {running ? "Consultando…" : `Explicar as ${count} primeiras`}
        </Button>
        <span className="text-xs text-muted-foreground">
          {result
            ? "A explicação vale só nesta tela até você aplicar."
            : `O ranking acima não custa nada. Só a explicação passa por um modelo (${formatUsdApprox(EXPLAIN_COST_USD)}).`}
        </span>
      </div>

      <ScopedTaskStrip
        running={running}
        label="Lendo as obras e escrevendo o porquê…"
        note="Se você sair desta tela agora, a explicação é perdida e o custo não volta."
        elapsed={elapsed}
      />

      {result && (
        <div className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
          {result.modeSummary && (
            <p className="text-sm text-muted-foreground">{result.modeSummary}</p>
          )}

          {/* Ordem da LISTA, não a do modelo: é assim que a pessoa casa cada parágrafo
              com a linha que está vendo acima. Por isso as notas saem fora de ordem — e
              por isso cada uma vem rotulada "Ver.", como na coluna da lista, senão o
              número violeta é lido como posição no ranking. */}
          <ol className="flex flex-col gap-3">
            {works.map((w) => {
              const r = byWork.get(w.id)
              if (!r) return null
              return (
                <li key={w.id} className="flex flex-col gap-1 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                      Ver. {Math.round(r.alignmentScore)}
                    </span>
                    <span className="font-medium">{w.title}</span>
                  </div>
                  <p className="text-muted-foreground">{r.justification}</p>
                </li>
              )
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-3 border-t border-violet-500/20 pt-3">
            {applied ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="h-4 w-4" />
                Aplicado ao catálogo
              </span>
            ) : (
              <Button size="sm" disabled={applying} onClick={aplicar}>
                {applying ? "Aplicando…" : "Aplicar ao catálogo"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {applied
                ? "O Veredito destas obras agora aparece no /ranking e nos favoritos."
                : "Sem aplicar, isto fica só aqui. Aplicar grava o Veredito IA destas obras nas outras telas."}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
