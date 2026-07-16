import { cn } from "@/lib/utils"
import type { CriterionTier } from "@/components/ui/score-badge"

// Cores por tier na mesma paleta das notas. Bordas via `ring` (não `border`): a utility de cor de
// borda do Tailwind está morta no projeto (regra global em globals.css — ver CLAUDE.md).
const BAR_CLASS: Record<CriterionTier, string> = {
  top: "bg-green-500/60 ring-1 ring-inset ring-green-500/70",
  high: "bg-green-500/50 ring-1 ring-inset ring-green-500/60",
  mid: "bg-yellow-500/60 ring-1 ring-inset ring-yellow-500/70",
  low: "bg-orange-500/60 ring-1 ring-inset ring-orange-500/70",
  bottom: "bg-red-500/60 ring-1 ring-inset ring-red-500/70",
  neutral: "bg-slate-400/50 ring-1 ring-inset ring-slate-400/60",
}
const SWATCH_CLASS: Record<CriterionTier, string> = {
  top: "bg-green-500",
  high: "bg-green-500",
  mid: "bg-yellow-500",
  low: "bg-orange-500",
  bottom: "bg-red-500",
  neutral: "bg-slate-400",
}

/** Inteiro sem decimal, fracionário com vírgula: 6 · 5,5. */
function fmtEdge(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",")
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n))

/**
 * Barra que SOBREPÕE a faixa ideal do perfil (zona de referência, cinza) e a faixa da nota do
 * atributo (segmento colorido pelo fit) — mais o marcador da nota exata. Dá pra ver, de relance, se
 * a faixa da obra cai dentro da sua zona ideal (e por isso a cor).
 */
export function CriterionFitBar({
  score,
  tier,
  idealMin,
  idealMax,
  hasIdeal,
  bandLo,
  bandHi,
  bandLabel,
}: {
  score: number
  tier: CriterionTier
  idealMin: number
  idealMax: number
  hasIdeal: boolean
  bandLo: number | null
  bandHi: number | null
  bandLabel: string | null
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] tracking-wide text-muted-foreground/70">
        {hasIdeal ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[3px] bg-muted-foreground/25 ring-1 ring-inset ring-muted-foreground/40" />
            faixa ideal{" "}
            <b className="font-semibold tabular-nums text-muted-foreground">
              {fmtEdge(idealMin)}–{fmtEdge(idealMax)}
            </b>
          </span>
        ) : (
          <span>sem peso no seu perfil</span>
        )}
        {bandLabel && (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-[3px]", SWATCH_CLASS[tier])} />
            faixa da nota{" "}
            <b className="font-semibold tabular-nums text-muted-foreground">{bandLabel}</b>
          </span>
        )}
      </div>
      <div className="relative h-3 rounded-full bg-muted/50">
        {hasIdeal && (
          <div
            className="absolute inset-y-0 rounded-full bg-muted-foreground/15 ring-1 ring-inset ring-muted-foreground/25"
            style={{ left: `${clampPct(idealMin * 10)}%`, width: `${clampPct((idealMax - idealMin) * 10)}%` }}
          />
        )}
        {bandLo != null && bandHi != null && (
          <div
            className={cn("absolute inset-y-0 rounded-full", BAR_CLASS[tier])}
            style={{ left: `${clampPct(bandLo * 10)}%`, width: `${Math.max(clampPct((bandHi - bandLo) * 10), 3)}%` }}
          />
        )}
        <div
          className="absolute top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.45)]"
          style={{ left: `${clampPct(score * 10)}%` }}
        />
      </div>
    </div>
  )
}
