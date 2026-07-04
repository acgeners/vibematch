"use client"

import type { ReactNode } from "react"
import { Gauge } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type {
  SynopsisPredictionAccuracy,
  SynopsisVersionComparison,
} from "@/server/queries/synopsis-quality"

function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`
}

type ConfLevel = "alta" | "média" | "baixa"
const CONF: Record<ConfLevel, { dot: string; text: string; bg: string }> = {
  alta: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-500/12" },
  "média": { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-300", bg: "bg-amber-500/12" },
  baixa: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-300", bg: "bg-rose-500/12" },
}

function confidenceOf(mae: number | null): ConfLevel | null {
  if (mae == null) return null
  if (mae <= 0.5) return "alta"
  if (mae <= 1.0) return "média"
  return "baixa"
}

function Tile({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] px-2.5 py-2">
      <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">{k}</div>
      <div className="text-lg font-bold leading-none tabular-nums">{children}</div>
    </div>
  )
}

/**
 * Gatilho discreto (pílula "Confiança: alta") + popover com o diagnóstico da
 * previsão de Interesse — confiança/métricas, comparação de versões e o Shadow
 * A/B (passado como `shadow`, pois é server component). Substitui as faixas fixas
 * que ficavam no topo da aba "Interesse na Obra".
 */
export function PredictionDiagnosticsPopover({
  accuracy,
  comparison,
  shadow,
}: {
  accuracy: SynopsisPredictionAccuracy
  comparison?: SynopsisVersionComparison | null
  /** ShadowComparePanel já renderizado (server). `null`/`undefined` = oculto. */
  shadow?: ReactNode
}) {
  const { n, meanDelta, mae, exactRate, within1Rate } = accuracy
  const level = confidenceOf(mae)
  const c = level ? CONF[level] : null

  const biasText =
    meanDelta == null || Math.abs(meanDelta) < 0.15
      ? "desprezível"
      : meanDelta > 0
        ? "IA superestima"
        : "IA subestima"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Gauge className="h-3.5 w-3.5" />
          Confiança:
          {level && c ? (
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", c.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
              {level}
            </span>
          ) : (
            <span>—</span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[440px] max-w-[92vw] p-0">
        {/* Confiança da previsão */}
        <div className="p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75">
              Confiança da previsão
            </span>
            {level && c && (
              <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", c.text, c.bg)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                {level}
              </span>
            )}
          </div>
          {mae == null ? (
            <p className="text-xs text-muted-foreground">
              Sem comparações no prompt atual. Re-preveja obras com{" "}
              <b className="font-semibold text-foreground">Interesse manual</b> preenchido pra medir a confiança.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Tile k="Erro médio">
                  {mae.toFixed(2)}
                  <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">níveis</span>
                </Tile>
                {exactRate != null && (
                  <Tile k="Exato">
                    {Math.round(exactRate * 100)}
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </Tile>
                )}
                {within1Rate != null && (
                  <Tile k="±1 nível">
                    {Math.round(within1Rate * 100)}
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </Tile>
                )}
                {meanDelta != null && <Tile k="Viés">{fmtSigned(meanDelta)}</Tile>}
              </div>
              <div className="mt-2.5 text-[11px] text-muted-foreground/80">
                {n} {n === 1 ? "comparação" : "comparações"}
                {n < 10 ? " (amostra pequena)" : ""} · viés {biasText}
              </div>
            </>
          )}
        </div>

        {/* Comparação de versões */}
        {comparison &&
          (() => {
            const { previousVersion, currentVersion, nPaired, maeCurrent, maePrevious, biasCurrent, biasPrevious, betterRate, worseRate } = comparison
            const diff = maePrevious - maeCurrent // > 0 ⇒ erro caiu (melhorou)
            const verdict =
              diff > 0.02
                ? { label: `${currentVersion} melhorou`, cls: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-500/12" }
                : diff < -0.02
                  ? { label: `${currentVersion} piorou`, cls: "text-rose-600 dark:text-rose-300", bg: "bg-rose-500/12" }
                  : { label: "empate técnico", cls: "text-muted-foreground", bg: "bg-muted/50" }
            const maeCls = diff > 0.02 ? "text-emerald-600 dark:text-emerald-300" : diff < -0.02 ? "text-rose-600 dark:text-rose-300" : "text-foreground"
            return (
              <div className="border-t border-border/50 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75">
                    Versões · {previousVersion} → {currentVersion} (pareado, {nPaired})
                  </span>
                  <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", verdict.cls, verdict.bg)}>
                    {verdict.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    MAE <b className={cn("font-mono", maeCls)}>{maePrevious.toFixed(2)} → {maeCurrent.toFixed(2)}</b>
                  </span>
                  <span>
                    viés <b className="font-mono text-foreground">{fmtSigned(biasPrevious)} → {fmtSigned(biasCurrent)}</b>
                  </span>
                  <span>
                    {currentVersion} mais perto em <b className="text-foreground">{Math.round(betterRate * 100)}%</b> · pior em {Math.round(worseRate * 100)}%
                  </span>
                </div>
              </div>
            )
          })()}

        {/* Shadow A/B (server component) */}
        {shadow && <div className="border-t border-border/50 p-3.5">{shadow}</div>}
      </PopoverContent>
    </Popover>
  )
}
