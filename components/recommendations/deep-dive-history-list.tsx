"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { getDeepDiveByIdAction } from "@/server/actions/deep-dive"
import { DeepDiveResultView } from "@/components/titles/deep-dive/deep-dive-result-view"
import type { DeepDiveReadWhen, DeepDiveResultRow } from "@/lib/ai-recommendation/types"
import type { DeepDiveSummary } from "@/server/queries/deep-dive"

const READ_WHEN_META: Record<
  DeepDiveReadWhen,
  { label: string; badge: string; swatch: string }
> = {
  agora: {
    label: "Ler agora",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    swatch: "bg-emerald-500",
  },
  guardar: {
    label: "Guardar",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    swatch: "bg-amber-500",
  },
  evitar: {
    label: "Evitar",
    badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    swatch: "bg-rose-500",
  },
}

const FILTERS: Array<{ key: "all" | DeepDiveReadWhen; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "agora", label: "Ler agora" },
  { key: "guardar", label: "Guardar" },
  { key: "evitar", label: "Evitar" },
]

export function DeepDiveHistoryList({
  dives,
  signedIn,
}: {
  dives: DeepDiveSummary[]
  /** Sem sessão o vazio é "entre para ver o SEU", não "rode um Deep Dive". */
  signedIn: boolean
}) {
  const [filter, setFilter] = useState<"all" | DeepDiveReadWhen>("all")
  const [openDive, setOpenDive] = useState<DeepDiveSummary | null>(null)
  const [full, setFull] = useState<DeepDiveResultRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: dives.length, agora: 0, guardar: 0, evitar: 0 }
    for (const d of dives) if (d.readWhen) c[d.readWhen] = (c[d.readWhen] ?? 0) + 1
    return c
  }, [dives])

  const rows = useMemo(
    () => (filter === "all" ? dives : dives.filter((d) => d.readWhen === filter)),
    [dives, filter],
  )

  const handleOpen = (dive: DeepDiveSummary) => {
    setOpenDive(dive)
    setFull(null)
    startTransition(async () => {
      const row = await getDeepDiveByIdAction(dive.id)
      setFull(row)
    })
  }

  if (dives.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card/30 p-6 text-center">
        <Sparkles className="mx-auto h-5 w-5 text-violet-500/70" />
        <p className="mt-2 text-sm font-medium text-foreground">
          {signedIn ? "Nenhum Deep Dive ainda" : "Os Deep Dives são pessoais"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {signedIn ? (
            <>
              Abra uma obra e rode o <span className="font-medium text-foreground">Consultor IA — Deep Dive</span>.
              Toda análise feita aparece aqui, sem precisar reabrir a obra.
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                Entre
              </Link>{" "}
              para ver as suas análises.
            </>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filtro por veredito */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 select-none">
          Veredito
        </span>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key
          const swatch = key !== "all" ? READ_WHEN_META[key].swatch : null
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                active
                  ? "border-border bg-card text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {swatch && <span className={cn("size-1.5 rounded-full", swatch)} />}
              {label}
              <span className="tabular-nums text-muted-foreground/70">{counts[key] ?? 0}</span>
            </button>
          )
        })}
      </div>

      {/* Lista */}
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          Nenhum Deep Dive com este veredito.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((dive) => {
            const meta = dive.readWhen ? READ_WHEN_META[dive.readWhen] : null
            return (
              <li key={dive.id}>
                <button
                  type="button"
                  onClick={() => handleOpen(dive)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card/40 p-2.5 text-left transition hover:bg-card/70"
                >
                  <CoverImage
                    urls={dive.coverUrls}
                    alt={dive.workTitle}
                    className="h-14 w-10 shrink-0 rounded-md object-cover"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {meta && (
                        <Badge
                          variant="outline"
                          className={cn("shrink-0 text-[11px] font-medium", meta.badge)}
                        >
                          {meta.label}
                        </Badge>
                      )}
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {dive.workTitle}
                      </span>
                    </div>
                    {dive.oneLiner && (
                      <p className="mt-1 truncate text-xs italic text-muted-foreground">
                        &ldquo;{dive.oneLiner}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1 pl-1">
                    {dive.matchScore != null && (
                      <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                        {Math.round(dive.matchScore)}
                        <span className="text-[10px] font-medium text-muted-foreground">/100</span>
                      </span>
                    )}
                    {dive.confidence != null && (
                      <span
                        className="h-1 w-11 overflow-hidden rounded-full bg-border"
                        title={`confiança ${Math.round(dive.confidence * 100)}%`}
                      >
                        <span
                          className="block h-full rounded-full bg-violet-500"
                          style={{ width: `${Math.round(dive.confidence * 100)}%` }}
                        />
                      </span>
                    )}
                    <span className="text-[10px] tabular-nums text-muted-foreground/70">
                      {formatRelativeDateTime(dive.createdAt)}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Modal com a análise completa — reusa o DeepDiveResultView da página da obra */}
      <Dialog open={openDive !== null} onOpenChange={(o) => !o && setOpenDive(null)}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-4 py-3 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Consultor IA — Deep Dive
            </DialogTitle>
            <DialogDescription className="text-xs">
              {openDive ? (
                <>
                  Análise de{" "}
                  <span className="font-medium text-foreground">{openDive.workTitle}</span>
                </>
              ) : (
                "Análise profunda"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isPending || !full ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
                <p className="text-xs text-muted-foreground">Carregando análise…</p>
              </div>
            ) : (
              <DeepDiveResultView dive={full} workId={full.work_id} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
