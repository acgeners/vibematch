"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Check, AlertTriangle, X, Sparkles, RefreshCw, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { enrichWorkExternal } from "@/server/actions/enrich"
import type { EnrichResult, ReviewWork } from "@/server/actions/enrich"

type RowState = EnrichResult | "running" | undefined

const CONCURRENCY = 3

// Abre em nova aba via <a target="_blank"> clicado. window.open(url, "_blank",
// "...features...") abre POPUP (3º arg) — frequentemente bloqueado/falho,
// inclusive no navegador embutido do VSCode. Âncora abre aba de verdade.
function openInNewTab(url: string) {
  const a = document.createElement("a")
  a.href = url
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++])
  })
  await Promise.all(runners)
}

export function ImportReview({
  works,
  onReload,
  onBatchComplete,
  onReviewed,
}: {
  works: ReviewWork[]
  onReload?: () => void | Promise<void>
  // Disparado quando o lote "Buscar dados das sem capa" termina.
  onBatchComplete?: () => void
  // Disparado quando uma obra é revisada (some da lista) — o pai usa pra
  // decrementar o contador da aba.
  onReviewed?: (workId: string) => void
}) {
  const router = useRouter()
  const reload = onReload ?? (() => router.refresh())
  const [states, setStates] = useState<Record<string, RowState>>({})
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState<ReviewWork | null>(null)
  // Obras já revisadas nesta sessão — somem da lista mesmo após reload (ainda
  // ficam 'pending' no banco até serem avaliadas em /ai-evaluation).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visibleWorks = useMemo(() => works.filter((w) => !dismissed.has(w.id)), [works, dismissed])
  const coverless = useMemo(() => visibleWorks.filter((w) => w.coverCount === 0), [visibleWorks])

  const runBatch = async () => {
    // Só busca dados das que ainda não têm capa e não foram processadas nesta sessão.
    const targets = coverless.filter((w) => {
      const s = states[w.id]
      return s === undefined || (s !== "running" && s.status !== "enriched")
    })
    if (targets.length === 0) return
    setRunning(true)
    await runPool(targets, (w) => enrichOne(w.id), CONCURRENCY)
    setRunning(false)
    await reload()
    onBatchComplete?.()
  }

  const enrichOne = async (id: string) => {
    setStates((prev) => ({ ...prev, [id]: "running" }))
    try {
      const result = await enrichWorkExternal(id)
      setStates((prev) => ({ ...prev, [id]: result }))
    } catch (err) {
      setStates((prev) => ({
        ...prev,
        [id]: { workId: id, status: "error", message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }

  if (visibleWorks.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma obra pendente de revisão. 🎉</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {visibleWorks.length} pendentes · {coverless.length} sem capa
        </span>
        <div className="flex items-center gap-2">
          {coverless.length > 0 && (
            <Button onClick={runBatch} disabled={running}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </>
              ) : (
                `Buscar dados das sem capa (${coverless.length})`
              )}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/ai-evaluation">
              <Sparkles className="h-4 w-4" /> Avaliar notas
            </Link>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/60 rounded-lg border border-border/60">
        {visibleWorks.map((work) => {
          const state = states[work.id]
          const enriched = state && state !== "running" && state.status === "enriched" ? state : null
          const coverUrl = enriched?.coverUrl ?? work.coverPrimaryUrl
          const coverCount = enriched ? Math.max(work.coverCount, enriched.sources.length) : work.coverCount
          const synopsisCount = enriched ? Math.max(work.synopsisCount, 1) : work.synopsisCount

          return (
            <div key={work.id} className="flex items-center gap-3 p-2.5 text-sm">
              {/* capa */}
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded border border-border/60 bg-muted">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getCoverImageSrc(coverUrl)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
              </div>

              {/* título + meta */}
              <div className="min-w-0 flex-1">
                <Link href={`/titles/${work.id}`} className="block truncate font-medium hover:underline">
                  {work.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{coverCount} capas</Badge>
                  <Badge variant="outline" className="text-[10px]">{synopsisCount} sinopses</Badge>
                  <Badge variant="secondary" className="text-[10px]">IA: {work.aiEvalStatus}</Badge>
                  <EnrichStatus state={state} />
                </div>
              </div>

              {/* ações */}
              <div className="flex shrink-0 items-center gap-2">
                {work.coverCount === 0 && !enriched && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state === "running" || running}
                    onClick={() => enrichOne(work.id)}
                  >
                    {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Buscar dados
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setActive(work)}>
                  Revisar
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Picker de capa/sinopse reaproveitando o fluxo "Atualizar dados". */}
      {active && (
        <UpdateDataDialog
          key={active.id}
          workId={active.id}
          hideTrigger
          open
          onSaved={(workId) => {
            // Abre a obra em nova aba após escolher sinopse/capa e remove da
            // lista de pendentes (revisada).
            openInNewTab(`/titles/${workId}`)
            setDismissed((prev) => new Set(prev).add(workId))
            onReviewed?.(workId)
          }}
          onOpenChange={(v) => {
            if (!v) {
              setActive(null)
              void reload()
            }
          }}
          currentWork={{
            title: active.title,
            originalTitle: active.originalTitle,
            synopsis: active.synopsisPrimary,
            coverUrl: active.coverPrimaryUrl,
            publicationStatus: active.publicationStatus,
            totalChapters: active.totalChapters,
            observations: active.observations,
          }}
        />
      )}
    </div>
  )
}

function EnrichStatus({ state }: { state: RowState }) {
  if (!state || state === "running") return null
  if (state.status === "enriched") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
        <Check className="h-3.5 w-3.5" /> {state.sources.slice(0, 4).join(", ")}
      </span>
    )
  }
  if (state.status === "needs_review") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" /> {state.reason}
        {state.suggestion ? ` · talvez "${state.suggestion.title}" (${Math.round(state.suggestion.score * 100)}%)` : ""}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <X className="h-3.5 w-3.5" /> {state.message}
    </span>
  )
}
