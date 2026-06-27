"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import { ArrowDown, ArrowUp, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { PERSONAL_STATUSES, SYNOPSIS_QUALITIES } from "@/types/domain"
import type { NoTagsSort, NoTagsSortKey } from "@/lib/tags/no-tags-classify"

const PUB_OPTIONS = Object.values(PUBLICATION_STATUSES_BY_ID).map((i) => i.status)

const SORT_OPTIONS: { key: NoTagsSortKey; label: string }[] = [
  { key: "title", label: "Título" },
  { key: "expected", label: "Nota prevista" },
  { key: "tags", label: "Nº tags" },
]

export function SemTagsFilters({
  q,
  activePubStatuses,
  activePersonalStatuses,
  activeInterest,
  hasExternal,
  goldenOnly,
  minTags,
  maxTags,
  sort,
}: {
  q: string
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  activeInterest: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
  minTags: number
  maxTags: number
  sort: NoTagsSort
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function commit(next: URLSearchParams) {
    next.set("tab", "sem-tags")
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value == null || value === "") next.delete(key)
    else next.set(key, value)
    commit(next)
  }
  function toggleInSet(key: string, active: string[], value: string) {
    const set = new Set(active)
    if (set.has(value)) set.delete(value)
    else set.add(value)
    setParam(key, set.size > 0 ? [...set].join(",") : null)
  }
  function setCount(key: string, raw: string, current: number) {
    const n = Math.max(0, Math.floor(Number(raw)))
    if (n === current) return
    setParam(key, Number.isFinite(n) && n > 0 ? String(n) : null)
  }
  function setSort(key: NoTagsSortKey) {
    const dir: "asc" | "desc" = sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "title" ? "asc" : "desc"
    const isDefault = key === "title" && dir === "asc"
    setParam("sortt", isDefault ? null : `${key}-${dir}`)
  }

  const hasAny =
    q ||
    activePubStatuses.length > 0 ||
    activePersonalStatuses.length > 0 ||
    activeInterest.length > 0 ||
    hasExternal != null ||
    goldenOnly ||
    minTags > 0 ||
    maxTags > 0 ||
    sort.key !== "title" ||
    sort.dir !== "asc"

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
        <span className="text-xs text-muted-foreground">Publicação:</span>
        {PUB_OPTIONS.map((s) => (
          <button key={s} type="button" onClick={() => toggleInSet("pub", activePubStatuses, s)} disabled={isPending}>
            <Badge variant={activePubStatuses.includes(s) ? "default" : "outline"} className={cn("cursor-pointer", isPending && "opacity-60")}>
              {s}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Leitura:</span>
        {PERSONAL_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => toggleInSet("personal", activePersonalStatuses, s)} disabled={isPending}>
            <Badge variant={activePersonalStatuses.includes(s) ? "default" : "outline"} className={cn("cursor-pointer", isPending && "opacity-60")}>
              {s}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Interesse:</span>
        {SYNOPSIS_QUALITIES.map((s) => (
          <button key={s} type="button" onClick={() => toggleInSet("synopsis_q", activeInterest, s)} disabled={isPending}>
            <Badge variant={activeInterest.includes(s) ? "default" : "outline"} className="cursor-pointer text-sm">
              {s}
            </Badge>
          </button>
        ))}
        <button type="button" onClick={() => toggleInSet("synopsis_q", activeInterest, "none")} disabled={isPending}>
          <Badge variant={activeInterest.includes("none") ? "default" : "outline"} className="cursor-pointer">
            Não avaliada
          </Badge>
        </button>
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
        <span className="ml-3 text-xs text-muted-foreground">Tags (mín/máx):</span>
        <Input
          key={`min-${minTags}`}
          type="number"
          min={0}
          step={1}
          defaultValue={minTags}
          onKeyDown={(e) => { if (e.key === "Enter") setCount("mintags", (e.target as HTMLInputElement).value, minTags) }}
          onBlur={(e) => setCount("mintags", e.target.value, minTags)}
          disabled={isPending}
          className="h-7 w-16"
          aria-label="Mínimo de tags"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          key={`max-${maxTags}`}
          type="number"
          min={0}
          step={1}
          defaultValue={maxTags}
          onKeyDown={(e) => { if (e.key === "Enter") setCount("maxtags", (e.target as HTMLInputElement).value, maxTags) }}
          onBlur={(e) => setCount("maxtags", e.target.value, maxTags)}
          disabled={isPending}
          className="h-7 w-16"
          aria-label="Máximo de tags"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Ordenar:</span>
        {SORT_OPTIONS.map((opt) => {
          const active = sort.key === opt.key
          return (
            <button key={opt.key} type="button" onClick={() => setSort(opt.key)} disabled={isPending}>
              <Badge variant={active ? "default" : "outline"} className="cursor-pointer gap-1">
                {opt.label}
                {active ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
              </Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}
