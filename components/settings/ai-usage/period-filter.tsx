"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { cn } from "@/lib/utils"

interface RangeOption {
  key: string
  label: string
}

interface Props {
  ranges: ReadonlyArray<RangeOption>
  active: string
}

/**
 * Seletor de período (?range=) — controle segmentado. Reescreve a URL
 * preservando o filtro de operação (?op=). Server param: remodela todos os
 * agregados da página.
 */
export function PeriodFilter({ ranges, active }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function select(key: string) {
    if (key === active) return
    const params = new URLSearchParams(searchParams.toString())
    if (key === "30d") params.delete("range")
    else params.set("range", key)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  return (
    <div
      role="group"
      aria-label="Período"
      className={cn(
        "inline-flex rounded-lg border border-border/70 bg-card/60 p-0.5 shadow-sm shadow-black/5",
        pending && "opacity-60",
      )}
    >
      {ranges.map((r) => {
        const isActive = r.key === active
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={isActive}
            disabled={pending}
            onClick={() => select(r.key)}
            className={cn(
              "rounded-[7px] px-2.5 py-1 text-xs font-semibold transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}
