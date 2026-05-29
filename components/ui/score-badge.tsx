import { cn } from "@/lib/utils"

export interface ScoreColorThresholds {
  p_top: number
  p_high: number
  p_mid: number
  p_low: number
}

/**
 * Thresholds calculados por coluna. Cada coluna (N.Final, N.IA, N.Pr) usa
 * sua própria distribuição — então o mesmo percentil pode resultar em
 * cutoffs diferentes em cada uma. Consumidores que exibem uma única nota
 * devem fatiar o slice apropriado antes de passar pro ScoreBadge.
 */
export interface ColumnThresholds {
  final: ScoreColorThresholds
  calc: ScoreColorThresholds
  predicted: ScoreColorThresholds
}

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: "sm" | "md" | "lg"
  className?: string
  showStub?: boolean
  trimIntegerDecimals?: boolean
  roundUpDisplay?: boolean
  variant?: "solid" | "soft"
  /**
   * Quando passado, as cores são definidas por bucket de percentil (top
   * 20% / 60-80% / 40-60% / 20-40% / bottom 20%, configurável em
   * /preferences). Quando omitido, cai pros thresholds fixos abaixo —
   * mantém compat com badges de critério individual (escala absoluta).
   */
  thresholds?: ScoreColorThresholds | null
}

const FIXED_CUTOFFS = { top: 8.5, high: 7.5, mid: 6.5, low: 5.5 }

function pickTier(
  score: number,
  thresholds: ScoreColorThresholds | null | undefined
): "top" | "high" | "mid" | "low" | "bottom" {
  const cuts = thresholds
    ? { top: thresholds.p_top, high: thresholds.p_high, mid: thresholds.p_mid, low: thresholds.p_low }
    : FIXED_CUTOFFS
  // Arredonda pra 1 casa decimal antes de comparar — mesma granularidade do
  // display (`score.toFixed(1)`), evita "flips invisíveis" perto da fronteira.
  const s = Math.round(score * 10) / 10
  if (s >= cuts.top) return "top"
  if (s >= cuts.high) return "high"
  if (s >= cuts.mid) return "mid"
  if (s >= cuts.low) return "low"
  return "bottom"
}

function getScoreColor(score: number, thresholds: ScoreColorThresholds | null | undefined): string {
  switch (pickTier(score, thresholds)) {
    case "top": return "bg-green-500 text-white"
    case "high": return "bg-emerald-500 text-white"
    case "mid": return "bg-yellow-500 text-yellow-950"
    case "low": return "bg-orange-500 text-white"
    case "bottom": return "bg-red-500 text-white"
  }
}

function getSoftScoreColor(score: number, thresholds: ScoreColorThresholds | null | undefined): string {
  switch (pickTier(score, thresholds)) {
    case "top": return "bg-green-500/15 text-green-700 border border-green-500/25 dark:text-green-400 dark:border-green-500/30"
    case "high": return "bg-emerald-500/15 text-emerald-700 border border-emerald-500/25 dark:text-emerald-400 dark:border-emerald-500/30"
    case "mid": return "bg-yellow-500/20 text-yellow-800 border border-yellow-500/30 dark:text-yellow-400 dark:border-yellow-500/35"
    case "low": return "bg-orange-500/15 text-orange-700 border border-orange-500/25 dark:text-orange-400 dark:border-orange-500/30"
    case "bottom": return "bg-red-500/15 text-red-700 border border-red-500/25 dark:text-red-400 dark:border-red-500/30"
  }
}

/**
 * Variante text-only do score color — para casos onde a nota é exibida como
 * número grande (stats headers, totais) e não como pílula. Usa a mesma lógica
 * de tier de `ScoreBadge`, garantindo cores consistentes em todo o app.
 */
export function getScoreTextColor(
  score: number | null | undefined,
  thresholds: ScoreColorThresholds | null | undefined,
): string {
  if (score == null) return "text-muted-foreground"
  switch (pickTier(score, thresholds)) {
    case "top": return "text-green-600 dark:text-green-300"
    case "high": return "text-emerald-600 dark:text-emerald-300"
    case "mid": return "text-yellow-600 dark:text-yellow-300"
    case "low": return "text-orange-600 dark:text-orange-300"
    case "bottom": return "text-red-600 dark:text-red-300"
  }
}

const sizeClasses = {
  sm: "text-xs px-1.5 py-0.5 min-w-[2rem]",
  md: "text-sm px-2 py-0.5 min-w-[2.5rem]",
  lg: "text-base px-3 py-1 min-w-[3rem]",
}

export function ScoreBadge({
  score,
  size = "md",
  className,
  showStub = false,
  trimIntegerDecimals = false,
  roundUpDisplay = false,
  variant = "solid",
  thresholds,
}: ScoreBadgeProps) {
  if (score == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md font-mono font-semibold",
          "bg-muted text-muted-foreground",
          sizeClasses[size],
          className
        )}
      >
        —
      </span>
    )
  }

  const isSoft = variant === "soft"

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-mono font-semibold",
        isSoft ? getSoftScoreColor(score, thresholds) : getScoreColor(score, thresholds),
        !isSoft && "ring-1 ring-inset ring-white/15",
        sizeClasses[size],
        className
      )}
      title={showStub ? "Nota prevista estimada (sem modelo ML)" : undefined}
    >
      {roundUpDisplay
        ? String(Math.ceil(score))
        : trimIntegerDecimals && score % 1 === 0
          ? score.toFixed(0)
          : score.toFixed(1)}
      {showStub && <span className="ml-0.5 opacity-60 text-[10px]">~</span>}
    </span>
  )
}
