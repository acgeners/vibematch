import { cn } from "@/lib/utils"

export interface ScoreColorThresholds {
  p_top: number
  p_high: number
  p_mid: number
  p_low: number
}

/**
 * Thresholds calculados por coluna. Cada coluna (Nota Prevista, Nota.Calc) usa
 * sua própria distribuição — então o mesmo percentil pode resultar em
 * cutoffs diferentes em cada uma. Consumidores que exibem uma única nota
 * devem fatiar o slice apropriado antes de passar pro ScoreBadge.
 */
export interface ColumnThresholds {
  /** Nota Prevista (expected_score) — a coluna principal do catálogo. */
  expected: ScoreColorThresholds | null
  /** Nota.Calc determinístico (calc_score) — âncora de ensemble do expected. */
  calc: ScoreColorThresholds | null
  /**
   * Cutoffs por critério (slug → thresholds), cada um calculado sobre a
   * distribuição daquele atributo no catálogo. Usado pra colorir os 9
   * atributos por percentil individual (em vez dos limiares fixos 8/6/4).
   * Ausente/sem entrada pra um slug → cai nos limiares fixos.
   */
  criteria?: Record<string, ScoreColorThresholds>
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
   * /preferencias). Quando omitido, cai pros thresholds fixos abaixo —
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

// Critérios negativos: nota BAIXA é boa (drama/tragedy baixos = obra leve).
const NEGATIVE_CRITERIA = new Set<string>(["drama", "tragedy"])

// Pílulas soft por tier — usadas pelas células de atributo (escala 0–10).
const CRITERION_TIER_CLASS: Record<"top" | "high" | "mid" | "low" | "bottom", string> = {
  top: "bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25",
  high: "bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25",
  mid: "bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-400 dark:border-yellow-500/25",
  low: "bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/25",
  bottom: "bg-red-100 text-red-800 border border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25",
}

const TIER_ORDER = ["top", "high", "mid", "low", "bottom"] as const

/**
 * Classe de cor (pílula soft) pra uma nota de atributo (0–10).
 *
 * - Com `thresholds` (percentil daquele critério): usa `pickTier`. Pra critérios
 *   negativos (drama/tragedy) o tier é INVERTIDO — percentil alto = ruim = vermelho.
 * - Sem thresholds: cai nos limiares fixos históricos (positivo 8/6/4; negativo 3/5)
 *   pra não regredir visualmente quando o pool é pequeno ou não há config.
 */
export function getCriterionColorClass(
  score: number,
  slug: string,
  thresholds?: ScoreColorThresholds | null,
): string {
  const isNegative = NEGATIVE_CRITERIA.has(slug)
  if (thresholds) {
    const tier = pickTier(score, thresholds)
    if (!isNegative) return CRITERION_TIER_CLASS[tier]
    // Inverte: top↔bottom, high↔low, mid fica.
    const idx = TIER_ORDER.indexOf(tier)
    const inverted = TIER_ORDER[TIER_ORDER.length - 1 - idx]
    return CRITERION_TIER_CLASS[inverted]
  }
  // Fallback fixo (comportamento histórico).
  if (isNegative) {
    if (score <= 3) return CRITERION_TIER_CLASS.high
    if (score <= 5) return CRITERION_TIER_CLASS.mid
    return CRITERION_TIER_CLASS.bottom
  }
  if (score >= 8) return CRITERION_TIER_CLASS.top
  if (score >= 6) return CRITERION_TIER_CLASS.high
  if (score >= 4) return CRITERION_TIER_CLASS.mid
  return CRITERION_TIER_CLASS.bottom
}

// ── Coloração por FAIXA IDEAL (perfil) ───────────────────────────────────────
// Alternativa ao percentil-no-catálogo: a cor mede a DISTÂNCIA da nota até a
// faixa ideal do usuário [ideal_min, ideal_max]. Dentro da faixa = melhor;
// fora, decai por proximidade. Drama/tragédia deixam de ser caso especial —
// viram apenas uma faixa ideal baixa. Reusa a lógica de decaimento do
// `criterionAlignment` (personal-fit) em forma de tiers de cor.

export type AttrColorMode = "catalog" | "range"

export interface CriterionRange {
  ideal_min: number
  ideal_max: number
  weight: number
}

export type CriterionTier = "top" | "high" | "mid" | "low" | "bottom" | "neutral"

// Peso abaixo disso = critério que o usuário não liga → cor neutra (cinza),
// pintar de verde/vermelho seria enganoso.
const RANGE_NEUTRAL_WEIGHT = 0.05

const NEUTRAL_CRITERION_CLASS = "bg-muted/60 text-muted-foreground border border-border/50"

/**
 * Tier de uma nota de atributo pela DISTÂNCIA até a faixa ideal do perfil.
 * Dentro de [ideal_min, ideal_max] → "top". Fora, decai: ≤1 pt → high, ≤2 →
 * mid, ≤3 → low, além → bottom. Peso ~0 → "neutral". Arredonda a 1 casa
 * (mesma granularidade do display) pra evitar flips invisíveis na fronteira.
 */
export function pickCriterionTierByRange(score: number, range: CriterionRange): CriterionTier {
  if (range.weight < RANGE_NEUTRAL_WEIGHT) return "neutral"
  const s = Math.round(score * 10) / 10
  if (s >= range.ideal_min && s <= range.ideal_max) return "top"
  const distance = s < range.ideal_min ? range.ideal_min - s : s - range.ideal_max
  if (distance <= 1) return "high"
  if (distance <= 2) return "mid"
  if (distance <= 3) return "low"
  return "bottom"
}

/** Classe de pílula soft pela faixa ideal (mesma paleta de `getCriterionColorClass`). */
export function getCriterionColorClassByRange(score: number, range: CriterionRange): string {
  const tier = pickCriterionTierByRange(score, range)
  return tier === "neutral" ? NEUTRAL_CRITERION_CLASS : CRITERION_TIER_CLASS[tier]
}

/**
 * Dispatcher único da cor de célula de atributo, pelo modo ativo:
 * - "range": distância à faixa ideal do perfil (quando há pref pro slug).
 * - "catalog": percentil no catálogo (histórico; drama/tragédia invertidos).
 * Cai pro catálogo quando não há faixa pro slug.
 */
export function criterionCellClass(opts: {
  score: number
  slug: string
  mode: AttrColorMode
  thresholds?: ScoreColorThresholds | null
  range?: CriterionRange | null
}): string {
  if (opts.mode === "range" && opts.range) return getCriterionColorClassByRange(opts.score, opts.range)
  return getCriterionColorClass(opts.score, opts.slug, opts.thresholds)
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
      title={showStub ? "Nota Prevista estimada (sem modelo ML)" : undefined}
    >
      {roundUpDisplay
        ? String(Math.ceil(score))
        : trimIntegerDecimals && score % 1 === 0
          ? score.toFixed(0)
          : score.toFixed(1)}
      {showStub && <span className="ml-0.5 opacity-60 text-[11px]">~</span>}
    </span>
  )
}
