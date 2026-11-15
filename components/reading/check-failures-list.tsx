"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { cn, titleToSlug } from "@/lib/utils"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import { failureReasons, groupByReason, reasonKey } from "@/lib/reading/check-failures"
import type { CheckFailureItem } from "@/lib/reading/last-check-store"

/**
 * As obras "não verificadas" de uma checagem de capítulos, com o motivo de cada fonte. Usada na
 * janela da `/reading` e no painel "Capítulos e status" do catálogo — uma lista só, para as duas
 * telas nunca descreverem a mesma falha de jeitos diferentes.
 *
 * O resumo do topo agrupa por motivo (clicar filtra): quando a fonte está ocupada, quase todas as
 * obras repetem o mesmo motivo, e é isso que a pessoa precisa ver de cara. Vermelho é falha da
 * fonte; cinza é "não tem" (régua de `STATUS_TONE`). O texto cru do log vai na dica do rótulo.
 *
 * `limit` mostra só as primeiras N linhas, com "Ver todas" (o painel do catálogo usa 10).
 */
export function CheckFailuresList({ items, limit }: { items: CheckFailureItem[]; limit?: number }) {
  const [filter, setFilter] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const groups = useMemo(() => groupByReason(items), [items])
  const visible = useMemo(
    () => (filter ? items.filter((i) => failureReasons(i.failure).some((r) => reasonKey(r) === filter)) : items),
    [items, filter],
  )
  const shown = limit && !showAll ? visible.slice(0, limit) : visible

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Por motivo</p>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={filter === g.key}
              onClick={() => setFilter(filter === g.key ? null : g.key)}
              className={cn(
                STATUS_CHIP_BASE,
                STATUS_TONE[g.tone].chip,
                "cursor-pointer font-medium",
                filter === g.key && "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background",
              )}
            >
              <span className="truncate">{g.key}</span>
              <span className="font-bold tabular-nums">{g.count}</span>
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {shown.map((item) => (
          <li
            key={item.workId}
            className="flex flex-col gap-1.5 px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
          >
            <Link
              href={`/catalog/${titleToSlug(item.title)}`}
              title={item.title}
              className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
            >
              {item.title}
            </Link>
            <div className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:justify-end">
              {failureReasons(item.failure).map((r) => (
                <span
                  key={reasonKey(r)}
                  title={r.raw}
                  className={cn(
                    "inline-flex max-w-full cursor-help items-center rounded-md border px-2 py-0.5 text-[11px]",
                    STATUS_TONE[r.tone].chip,
                  )}
                >
                  <span className="truncate">
                    {r.source && <span className="font-semibold">{r.source} · </span>}
                    {r.label}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {limit && visible.length > limit && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showAll ? `Mostrar só ${limit}` : `Ver todas as ${visible.length}`}
        </button>
      )}
    </div>
  )
}
