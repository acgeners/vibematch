import { Gauge } from "lucide-react"
import type {
  SynopsisPredictionAccuracy,
  SynopsisVersionComparison,
} from "@/server/queries/synopsis-quality"

function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`
}

/**
 * Termômetro de confiança da previsão de Interesse Sinopse: erro médio (MAE),
 * viés e taxas de acerto entre a previsão da IA e o valor manual, em níveis
 * (♥=1 … ♥♥♥♥=4). Recalculado a cada page load — melhora conforme mais previsões
 * e manuais existem.
 */
export function SynopsisAccuracyBar({
  accuracy,
  comparison,
}: {
  accuracy: SynopsisPredictionAccuracy
  /** Comparação pareada com a versão de prompt anterior (quando ambas existem). */
  comparison?: SynopsisVersionComparison | null
}) {
  const { n, meanDelta, mae, exactRate, within1Rate } = accuracy

  if (n === 0 || mae == null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-4 py-2.5 text-xs text-muted-foreground">
        <Gauge className="h-4 w-4" />
        Sem comparações no prompt atual. Re-preveja as obras (com <strong className="font-semibold text-foreground">Interesse manual</strong> preenchido) pra medir a confiança da versão vigente.
      </div>
    )
  }

  // Rótulo qualitativo pela magnitude do erro (em níveis de ♥).
  const confidence =
    mae <= 0.5
      ? { label: "alta", cls: "text-emerald-600 dark:text-emerald-300" }
      : mae <= 1.0
        ? { label: "média", cls: "text-amber-600 dark:text-amber-300" }
        : { label: "baixa", cls: "text-rose-600 dark:text-rose-300" }

  // Limiar de viés alinhado ao arredondamento exibido (2 casas): abaixo de 0,15
  // o número mostrado (±0,10) é desprezível, evita "+0.10 (superestima)".
  const biasText =
    meanDelta == null || Math.abs(meanDelta) < 0.15
      ? "desprezível"
      : meanDelta > 0
        ? "IA superestima"
        : "IA subestima"

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          Confiança da previsão: <span className={confidence.cls}>{confidence.label}</span>
        </span>
        <span className="text-muted-foreground">
          erro médio <strong className="font-mono font-semibold text-foreground">{mae.toFixed(2)}</strong> nível{mae !== 1 ? "s" : ""}
        </span>
        {meanDelta != null && (
          <span className="text-muted-foreground" title="Viés = média de (previsto − manual)">
            viés <strong className="font-mono font-semibold text-foreground">{fmtSigned(meanDelta)}</strong> ({biasText})
          </span>
        )}
        {exactRate != null && (
          <span className="text-muted-foreground">
            exato <strong className="font-semibold text-foreground">{Math.round(exactRate * 100)}%</strong>
          </span>
        )}
        {within1Rate != null && (
          <span className="text-muted-foreground">
            ±1 nível <strong className="font-semibold text-foreground">{Math.round(within1Rate * 100)}%</strong>
          </span>
        )}
        <span className="text-muted-foreground/80">· {n} {n === 1 ? "comparação" : "comparações"}{n < 10 ? " (amostra pequena)" : ""}</span>
      </div>

      {comparison &&
        (() => {
          const { previousVersion, currentVersion, nPaired, maeCurrent, maePrevious, biasCurrent, biasPrevious, betterRate, worseRate } = comparison
          const diff = maePrevious - maeCurrent // > 0 ⇒ erro caiu (melhorou)
          const verdict =
            diff > 0.02
              ? { label: `${currentVersion} melhorou`, cls: "text-emerald-600 dark:text-emerald-300" }
              : diff < -0.02
                ? { label: `${currentVersion} piorou`, cls: "text-rose-600 dark:text-rose-300" }
                : { label: "empate técnico", cls: "text-muted-foreground" }
          const maeCls = diff > 0.02 ? "text-emerald-600 dark:text-emerald-300" : diff < -0.02 ? "text-rose-600 dark:text-rose-300" : "text-foreground"
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 pt-1.5 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {previousVersion} → {currentVersion} (pareado, {nPaired})
              </span>
              <span>
                MAE <strong className={`font-mono ${maeCls}`}>{maePrevious.toFixed(2)} → {maeCurrent.toFixed(2)}</strong>
              </span>
              <span>
                viés <strong className="font-mono text-foreground">{fmtSigned(biasPrevious)} → {fmtSigned(biasCurrent)}</strong>
              </span>
              <span>
                {currentVersion} mais perto em <strong className="text-foreground">{Math.round(betterRate * 100)}%</strong> · pior em {Math.round(worseRate * 100)}%
              </span>
              <span className={`font-semibold ${verdict.cls}`}>{verdict.label}</span>
            </div>
          )
        })()}
    </div>
  )
}
