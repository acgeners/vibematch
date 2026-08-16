"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, AlertTriangle, X, Sparkles, RefreshCw, ImageOff, ListChecks, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn, titleToSlug } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { useIsAdmin } from "@/components/layout/admin-context"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import type { ReviewQueueMark } from "@/components/titles/update-data-dialog"
import { enrichWorkExternal } from "@/server/actions/enrich"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import type { EnrichResult, ReviewWork } from "@/server/actions/enrich"
import { deleteWork } from "@/server/actions/works"

type RowState = EnrichResult | "running" | undefined

const CONCURRENCY = 3
const ENRICH_TASK_ID = "enrich-batch"

/**
 * Fila de revisão em sequência. `cursor` aponta pra obra aberta agora; `marks`
 * guarda o desfecho de cada posição (os pontinhos de progresso da faixa).
 */
interface ReviewQueue {
  ids: string[]
  cursor: number
  marks: ReviewQueueMark[]
}

interface QueueSummary {
  reviewedIds: string[]
  skipped: number
}

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
  const isAdmin = useIsAdmin()
  const refresh = useRefresh()
  const reload = onReload ?? (() => refresh())
  const [states, setStates] = useState<Record<string, RowState>>({})
  const [running, setRunning] = useState(false)
  // Obras já revisadas nesta sessão — somem da lista mesmo após reload (ainda
  // ficam 'pending' no banco até serem avaliadas em /curation/works).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Puladas na fila: continuam pendentes, só ganham um selo na linha.
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  /** Revisão avulsa (botão "Revisar" da linha) — fora da fila. */
  const [soloId, setSoloId] = useState<string | null>(null)
  const [summary, setSummary] = useState<QueueSummary | null>(null)
  /** Obra(s) a excluir, aguardando confirmação — 1 id na exclusão da linha, várias no lote. */
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  /** Link da obra pelo SLUG quando o título é conhecido; UUID só como último recurso. */
  const hrefDaObra = (id: string) => {
    const t = byId.get(id)?.title
    return t ? `/catalog/${titleToSlug(t)}` : `/catalog/${id}`
  }
  const visibleWorks = useMemo(() => works.filter((w) => !dismissed.has(w.id)), [works, dismissed])
  const coverless = useMemo(() => visibleWorks.filter((w) => w.coverCount === 0), [visibleWorks])
  const selectedWorks = useMemo(
    () => visibleWorks.filter((w) => selected.has(w.id)),
    [visibleWorks, selected],
  )
  const selectedCoverless = selectedWorks.filter((w) => w.coverCount === 0)
  // Sem capa E sem sinopse — a página de "Revisar" dessas não tem nada pra mostrar.
  const selectedEmpty = selectedWorks.filter((w) => w.coverCount === 0 && w.synopsisCount === 0)

  const activeId = queue ? queue.ids[queue.cursor] : soloId
  const activeWork = activeId ? byId.get(activeId) ?? null : null

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

  const handleDelete = async (target: { ids: string[] }) => {
    setDeleting(true)
    const outcomes = await Promise.all(
      target.ids.map(async (id) => ({ id, result: await deleteWork(id) })),
    )
    setDeleting(false)
    setDeleteTarget(null)

    const succeeded = outcomes.filter((o) => !o.result.error).map((o) => o.id)
    const failed = outcomes.filter((o) => o.result.error)

    if (succeeded.length > 0) {
      setDismissed((prev) => new Set([...prev, ...succeeded]))
      setSelected((prev) => {
        const next = new Set(prev)
        succeeded.forEach((id) => next.delete(id))
        return next
      })
    }
    if (failed.length > 0) {
      toast.error(failed.length === 1 ? failed[0].result.error : `${failed.length} obras não puderam ser excluídas.`)
    } else {
      toast.success(succeeded.length > 1 ? `${succeeded.length} obras excluídas.` : "Obra excluída.")
    }
    if (succeeded.length > 0) await reload()
  }

  /**
   * Só busca dados das que ainda não têm capa e não foram processadas nesta
   * sessão. O lote vai pro indicador global porque é DURÁVEL — cada obra grava
   * assim que resolve — e são N buscas em fontes externas em fila de 3, o que
   * passa fácil de um minuto. O status POR LINHA continua aqui na tela: é o
   * detalhe que só faz sentido pra quem está olhando a lista.
   */
  const runBatch = async (pool: ReviewWork[]) => {
    const targets = pool.filter((w) => {
      const s = states[w.id]
      return s === undefined || (s !== "running" && s.status !== "enriched")
    })
    if (targets.length === 0) return
    setRunning(true)
    runTask({
      id: ENRICH_TASK_ID,
      kind: "enrich-batch",
      label: `Buscando dados de ${targets.length} obra${targets.length !== 1 ? "s" : ""}`,
      run: async () => {
        let done = 0
        setTaskProgress(ENRICH_TASK_ID, 0, targets.length)
        await runPool(
          targets,
          async (w) => {
            await enrichOne(w.id)
            done += 1
            setTaskProgress(ENRICH_TASK_ID, done, targets.length)
          },
          CONCURRENCY,
        )
        // `enrichOne` engole os erros por obra (viram estado da linha), então
        // aqui só o desfecho agregado interessa.
        return targets.length
      },
      successToast: (n) => ({ message: `Busca concluída em ${n} obra${n !== 1 ? "s" : ""}.` }),
      onDone: () => {
        setRunning(false)
        // `reload` pode ser síncrono (`onReload` é opcional e o default é
        // `refresh()`), então não dá pra encadear com `.then`.
        void (async () => {
          await reload()
          onBatchComplete?.()
        })()
      },
      onError: () => {
        setRunning(false)
        void reload()
      },
    })
  }

  // ── Fila ───────────────────────────────────────────────────────────────
  const startQueue = (ids: string[]) => {
    if (ids.length === 0) return
    setSummary(null)
    setSoloId(null)
    setQueue({ ids, cursor: 0, marks: ids.map((_, i) => (i === 0 ? "current" : "todo")) })
  }

  const finishQueue = (final: ReviewQueue) => {
    setQueue(null)
    setSummary({
      reviewedIds: final.ids.filter((_, i) => final.marks[i] === "done"),
      skipped: final.marks.filter((m) => m === "skipped").length,
    })
    void reload()
  }

  const abortQueue = () => {
    // As restantes continuam SELECIONADAS — dá pra retomar a fila de onde parou.
    setQueue(null)
    void reload()
  }

  /**
   * Fecha a obra atual e avança. `outcome` "reviewed" só chega pelo save; tudo
   * que fecha o diálogo sem salvar (Esc, clique fora, Cancelar, "Pular esta")
   * vira "skipped" e a obra continua na lista.
   */
  const resolveActive = (id: string, outcome: "reviewed" | "skipped") => {
    if (outcome === "reviewed") {
      setDismissed((prev) => new Set(prev).add(id))
      setSelected((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setSkippedIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      onReviewed?.(id)
    }

    if (!queue) {
      // Revisão avulsa: mantém o comportamento antigo — abre a obra em nova aba.
      setSoloId(null)
      // Slug, não UUID: "abrir em nova aba" é load DIRETO, e a rota por UUID redireciona
      // no servidor — o que responde 200 e estoura o Router do Next. `byId` já tem o título.
      if (outcome === "reviewed") openInNewTab(hrefDaObra(id))
      void reload()
      return
    }

    if (outcome === "skipped") setSkippedIds((prev) => new Set(prev).add(id))

    const marks = [...queue.marks]
    marks[queue.cursor] = outcome === "reviewed" ? "done" : "skipped"
    const cursor = queue.cursor + 1
    if (cursor >= queue.ids.length) {
      finishQueue({ ...queue, marks, cursor })
      return
    }
    marks[cursor] = "current"
    setQueue({ ...queue, marks, cursor })
  }

  /**
   * O UpdateDataDialog chama `onOpenChange(false)` ANTES de `onSaved`, no MESMO
   * tick (ver `applyUpdate` lá). Então "fechou" sozinho NÃO distingue salvar de
   * cancelar — sem isto, salvar contaria como pular e a obra avançaria duas
   * posições. Adiamos um microtask: se `onSaved` marcou o id nesse meio tempo,
   * o fechamento foi consequência do save e já está resolvido.
   */
  const savedIdRef = useRef<string | null>(null)
  const handleDialogClosed = (id: string) => {
    queueMicrotask(() => {
      if (savedIdRef.current === id) {
        savedIdRef.current = null
        return
      }
      resolveActive(id, "skipped")
    })
  }

  if (visibleWorks.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma obra pendente de revisão. 🎉</p>
  }

  const allSelected = selectedWorks.length > 0 && selectedWorks.length === visibleWorks.length
  const someSelected = selectedWorks.length > 0 && !allSelected

  return (
    <div className="space-y-4">
      {summary && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-600/45 bg-emerald-500/10 px-3 py-2 text-sm">
          <span>
            Fila concluída · <strong className="tabular-nums">{summary.reviewedIds.length}</strong>{" "}
            {summary.reviewedIds.length === 1 ? "revisada" : "revisadas"}
            {summary.skipped > 0 && (
              <>
                {" · "}
                <strong className="tabular-nums">{summary.skipped}</strong>{" "}
                {summary.skipped === 1 ? "pulada" : "puladas"} (seguem na lista)
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            {summary.reviewedIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => summary.reviewedIds.forEach((id) => openInNewTab(hrefDaObra(id)))}
              >
                Abrir as revisadas em abas
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSummary(null)}>
              Dispensar
            </Button>
          </div>
        </div>
      )}

      {selectedWorks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/45 bg-primary/10 px-3 py-2">
          <span className="text-sm">
            <strong className="tabular-nums">{selectedWorks.length}</strong>{" "}
            {selectedWorks.length === 1 ? "selecionada" : "selecionadas"}
            {selectedCoverless.length > 0 && (
              <span className="text-muted-foreground"> · {selectedCoverless.length} sem capa</span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={running || selectedCoverless.length === 0}
              onClick={() => void runBatch(selectedCoverless)}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Buscar dados das sem capa ({selectedCoverless.length})
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                disabled={selectedEmpty.length === 0}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteTarget({ ids: selectedEmpty.map((w) => w.id) })}
              >
                <Trash2 className="h-4 w-4" />
                Excluir sem dados ({selectedEmpty.length})
              </Button>
            )}
            <Button size="sm" onClick={() => startQueue(selectedWorks.map((w) => w.id))}>
              <ListChecks className="h-4 w-4" /> Revisar em sequência ({selectedWorks.length})
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(v) =>
                setSelected(v === true ? new Set(visibleWorks.map((w) => w.id)) : new Set())
              }
              aria-label="Selecionar todas"
              // O traço do estado indeterminado é um ::after — o Indicator do
              // componente base só sabe desenhar o check. O `dark:` no fundo é
              // obrigatório: sem ele o `dark:bg-input/35` da base vence (é o
              // mesmo motivo do `dark:data-[state=checked]:bg-primary` de lá).
              className="relative after:absolute after:inset-x-[3px] after:top-1/2 after:hidden after:h-0.5 after:-translate-y-1/2 after:rounded-full after:bg-primary-foreground after:content-[''] data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:after:block data-[state=indeterminate]:[&_svg]:hidden dark:data-[state=indeterminate]:bg-primary"
            />
            Selecionar todas
          </label>
          <span aria-hidden="true">·</span>
          <span>
            {visibleWorks.length} pendentes · {coverless.length} sem capa
          </span>
        </div>
        <div className="flex items-center gap-2">
          {coverless.length > 0 && (
            <Button onClick={() => void runBatch(coverless)} disabled={running}>
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
            <Link href="/curation/works">
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
          const isSelected = selected.has(work.id)

          return (
            <div
              key={work.id}
              className={cn("flex items-center gap-3 p-3 text-sm", isSelected && "bg-primary/[0.06]")}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(v) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (v === true) next.add(work.id)
                    else next.delete(work.id)
                    return next
                  })
                }
                aria-label={`Selecionar ${work.title}`}
              />

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
                <Link href={`/catalog/${titleToSlug(work.title)}`} className="block truncate font-medium hover:underline">
                  {work.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{coverCount} capas · {synopsisCount} sinopses</span>
                  {skippedIds.has(work.id) && (
                    <Badge variant="secondary" className="text-[11px]">pulada</Badge>
                  )}
                  <EnrichStatus state={state} />
                </div>
              </div>

              {/* ações — "Revisar" já dispara a mesma busca externa ao abrir, então
                  não repetimos "Buscar dados" aqui (segue só como ação de lote). */}
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setSoloId(work.id)}>
                  Revisar
                </Button>
                {isAdmin && coverCount === 0 && synopsisCount === 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Excluir obra"
                    aria-label={`Excluir ${work.title}`}
                    onClick={() => setDeleteTarget({ ids: [work.id] })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Picker de capa/sinopse reaproveitando o fluxo "Atualizar dados". A `key`
          remonta o diálogo a cada obra da fila — é o que zera os passos internos
          (sinopses/capas/conflitos) sem fechar e reabrir. */}
      {activeWork && (
        <UpdateDataDialog
          key={activeWork.id}
          workId={activeWork.id}
          hideTrigger
          open
          queue={
            queue
              ? {
                  index: queue.cursor,
                  total: queue.ids.length,
                  nextTitle: byId.get(queue.ids[queue.cursor + 1])?.title ?? null,
                  marks: queue.marks,
                  onSkip: () => resolveActive(activeWork.id, "skipped"),
                  onAbort: abortQueue,
                }
              : undefined
          }
          onSaved={(workId) => {
            savedIdRef.current = workId
            resolveActive(workId, "reviewed")
          }}
          onOpenChange={(v) => {
            if (!v) handleDialogClosed(activeWork.id)
          }}
          currentWork={{
            title: activeWork.title,
            originalTitle: activeWork.originalTitle,
            synopsis: activeWork.synopsisPrimary,
            coverUrl: activeWork.coverPrimaryUrl,
            publicationStatus: activeWork.publicationStatus,
            totalChapters: activeWork.totalChapters,
            observations: activeWork.observations,
          }}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget && deleteTarget.ids.length > 1
                ? `Excluir ${deleteTarget.ids.length} obras sem dados?`
                : "Excluir obra permanentemente?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.ids.length > 1
                ? "Nenhuma delas tem capa ou sinopse salva. Esta ação não pode ser desfeita."
                : "Esta ação não pode ser desfeita. A obra e todos os dados associados serão removidos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && deleteTarget.ids.length > 1 && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-2 text-sm">
              {deleteTarget.ids.map((id) => (
                <li key={id} className="truncate rounded px-1.5 py-1">
                  {byId.get(id)?.title ?? id}
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter className="gap-2 sm:justify-between">
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EnrichStatus({ state }: { state: RowState }) {
  if (!state || state === "running") return null
  if (state.status === "enriched") {
    // Fonte encontrada não pede ação nenhuma — fica neutro pra não competir
    // com o âmbar/vermelho das linhas que precisam de atenção.
    return <span>{state.sources.slice(0, 4).join(", ")}</span>
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
