"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import { Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"

const PUB_OPTIONS = Object.values(PUBLICATION_STATUSES_BY_ID).map((i) => i.status)

export function SemReviewsFilters({
  q,
  activePubStatuses,
  hasExternal,
  goldenOnly,
  maxReviews,
}: {
  q: string
  activePubStatuses: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
  maxReviews: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function commit(next: URLSearchParams) {
    next.set("tab", "sem-reviews")
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value == null || value === "") next.delete(key)
    else next.set(key, value)
    commit(next)
  }
  function togglePub(status: string) {
    const set = new Set(activePubStatuses)
    if (set.has(status)) set.delete(status)
    else set.add(status)
    setParam("pub", set.size > 0 ? [...set].join(",") : null)
  }
  function setMaxReviews(raw: string) {
    const n = Math.max(0, Math.floor(Number(raw)))
    setParam("maxrev", Number.isFinite(n) && n > 0 ? String(n) : null)
  }

  const hasAny = q || activePubStatuses.length > 0 || hasExternal != null || goldenOnly || maxReviews > 0

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            key={q}
            defaultValue={q}
            onKeyDown={(e) => { if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value.trim() || null) }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== q) setParam("q", v || null) }}
            placeholder="Buscar por título…"
            className="pl-8"
            aria-label="Buscar por título"
          />
        </div>
        {hasAny ? (
          <Button variant="ghost" size="sm" onClick={() => commit(new URLSearchParams())} disabled={isPending}>
            <X className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Status:</span>
        {PUB_OPTIONS.map((s) => (
          <button key={s} type="button" onClick={() => togglePub(s)} disabled={isPending}>
            <Badge variant={activePubStatuses.includes(s) ? "default" : "outline"} className={cn("cursor-pointer", isPending && "opacity-60")}>
              {s}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Fonte externa:</span>
        <button type="button" onClick={() => setParam("src", hasExternal === "yes" ? null : "yes")} disabled={isPending}>
          <Badge variant={hasExternal === "yes" ? "default" : "outline"} className="cursor-pointer">Possui</Badge>
        </button>
        <button type="button" onClick={() => setParam("src", hasExternal === "no" ? null : "no")} disabled={isPending}>
          <Badge variant={hasExternal === "no" ? "default" : "outline"} className="cursor-pointer">Sem fonte aceita</Badge>
        </button>
        <span className="ml-3 text-xs text-muted-foreground">Golden:</span>
        <button type="button" onClick={() => setParam("golden", goldenOnly ? null : "1")} disabled={isPending}>
          <Badge variant={goldenOnly ? "default" : "outline"} className="cursor-pointer">Só golden pilot-1</Badge>
        </button>
        <span className="ml-3 text-xs text-muted-foreground">Máx. reviews úteis:</span>
        <Input
          key={maxReviews}
          type="number"
          min={0}
          step={1}
          defaultValue={maxReviews}
          onKeyDown={(e) => { if (e.key === "Enter") setMaxReviews((e.target as HTMLInputElement).value) }}
          onBlur={(e) => { if (Math.max(0, Math.floor(Number(e.target.value))) !== maxReviews) setMaxReviews(e.target.value) }}
          disabled={isPending}
          className="h-7 w-16"
          aria-label="Máximo de reviews úteis"
        />
      </div>
    </div>
  )
}
