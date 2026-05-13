import { cn } from "@/lib/utils"

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: "sm" | "md" | "lg"
  className?: string
  showStub?: boolean
  trimIntegerDecimals?: boolean
  roundUpDisplay?: boolean
  variant?: "solid" | "soft"
}

function getScoreColor(score: number): string {
  if (score >= 8.5) return "bg-emerald-500 text-white"
  if (score >= 7.5) return "bg-green-500 text-white"
  if (score >= 6.5) return "bg-yellow-500 text-white"
  if (score >= 5.5) return "bg-orange-500 text-white"
  return "bg-red-500 text-white"
}

function getSoftScoreColor(score: number): string {
  if (score >= 8.5) return "bg-emerald-500/15 text-emerald-700 border border-emerald-500/25"
  if (score >= 7.5) return "bg-green-500/15 text-green-700 border border-green-500/25"
  if (score >= 6.5) return "bg-yellow-500/20 text-yellow-800 border border-yellow-500/30"
  if (score >= 5.5) return "bg-orange-500/15 text-orange-700 border border-orange-500/25"
  return "bg-red-500/15 text-red-700 border border-red-500/25"
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
}: ScoreBadgeProps) {
  if (score == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded font-mono font-semibold",
          "bg-muted text-muted-foreground",
          sizeClasses[size],
          className
        )}
      >
        —
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-mono font-semibold",
        variant === "soft" ? getSoftScoreColor(score) : getScoreColor(score),
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
