"use client"

import { useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { ArrowDown, ArrowUp, Loader2, Sparkles, Tag, MessageSquare } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { PredictSynopsisRowActions } from "@/components/titles/predict-synopsis-row-actions"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import { SynopsisInputsPopover } from "@/components/ai-evaluation/synopsis-inputs-popover"
import { TaskButton } from "@/components/ai-evaluation/task-button"
import {
  planSynopsisInterestBatchAction,
  runSynopsisInterestBatchAction,
  applySynopsisPredictionForWorks,
} from "@/server/actions/synopsis-quality"
import type { ApplySynopsisBatchResult } from "@/server/actions/synopsis-quality"
import { cn } from "@/lib/utils"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQueueWork } from "@/server/queries/recommendations"

/** Nível ordinal do Interesse (♥=1 … ♥♥♥♥=4); 0 se desconhecido. */
function synopsisLevel(q: string | null): number {
  if (!q) return 0
  const idx = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return idx >= 0 ? idx + 1 : 0
}

/** DD/MM/AAAA a partir do ISO (slice — evita mismatch de fuso/hidratação). */
function fmtPredictedAt(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : null
}

type SortField = "default" | "expected" | "lastRead" | "predicted"

/** Opções de tamanho de lote por run. Teto do servidor = 100 (SYNOPSIS_BATCH_MAX). */
const BATCH_OPTIONS = [10, 30, 50, 100] as const
const DEFAULT_BATCH_SIZE = 30

/**
 * Fila de Interesse Sinopse (aba /ai-evaluation?tab=sinopse): obras com sinopse
 * canônica que precisam de estimativa (desatualizada ou não prevista). Mesmo
 * layout de cards da fila de IA Rk. O botão de lote cobre até `batchSize` por run
 * (perfil cacheado); item a item usa o PredictSynopsisRowActions.
 */
export function SynopsisPredictPanel({ works, isPaid = true }: { works: SynopsisQueueWork[]; isPaid?: boolean }) {
  const refresh = useRefresh()
  const [sortField, setSortField] = useState<SortField>("default")
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_BATCH_SIZE)
  const [batchRunning, setBatchRunning] = useState(false)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sortedWorks = useMemo(() => {
    if (sortField === "default") {
      // Desatualizados primeiro, depois não previstos; cada grupo por título.
      return [...works].sort((a, b) => {
        const aStale = a.predictedQuality != null && a.predictionStale ? 0 : 1
        const bStale = b.predictedQuality != null && b.predictionStale ? 0 : 1
        if (aStale !== bStale) return aStale - bStale
        return a.title.localeCompare(b.title, "pt-BR")
      })
    }
    const mult = sortDir === "asc" ? 1 : -1
    if (sortField === "lastRead" || sortField === "predicted") {
      // Datas ISO comparam lexicograficamente = cronologicamente. Nulos no fim.
      const key = (w: SynopsisQueueWork) => (sortField === "lastRead" ? w.lastReadAt : w.predictedAt)
      return [...works].sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        if (ka == null && kb == null) return 0
        if (ka == null) return 1
        if (kb == null) return -1
        return ka < kb ? -1 * mult : ka > kb ? 1 * mult : 0
      })
    }
    return [...works].sort((a, b) => {
      const ka = a.expectedScore
      const kb = b.expectedScore
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  // Alvos do lote = obras VISÍVEIS na fila que ainda precisam de previsão
  // (não previstas ou desatualizadas), na ordem exibida, cortadas em batchSize.
  // Garante que "Estimar N" age sobre os cards que o usuário está vendo.
  const pendingTargets = useMemo(
    () => sortedWorks.filter((w) => w.predictedQuality == null || w.predictionStale),
    [sortedWorks],
  )
  const batchIds = pendingTargets.slice(0, batchSize).map((w) => w.id)
  const remainingAfterBatch = Math.max(pendingTargets.length - batchIds.length, 0)

  // Alvos do "Aplicar em fila" = obras VISÍVEIS com previsão e proveniência
  // `legacy_unknown` (sem valor OU com valor legado/não-confirmado). Aplicar
  // substitui o valor pela previsão (source→prediction_applied). NUNCA inclui
  // `human_manual` (o server protege por garantia). Divergências em obras já
  // aplicadas ficam no botão "Aplicar" por linha.
  const applyTargets = useMemo(
    () => sortedWorks.filter((w) => w.predictedQuality != null && w.synopsisQualitySource === "legacy_unknown"),
    [sortedWorks],
  )

  // Executa o lote já confirmado (uma autorização da cascata). Custo total
  // governado pelo teto = upper bound do dry-run.
  const executeBatch = async (ids: string[], maxCostUsd: number) => {
    setBatchRunning(true)
    try {
      const res = await runSynopsisInterestBatchAction(ids, { maxCostUsd })
      if (res.status === "ok") {
        const r = res.report
        toast.success(
          `${r.succeeded} estimada${r.succeeded !== 1 ? "s" : ""} · ${r.fresh} já ok` +
            (r.failed > 0 ? ` · ${r.failed} falhou` : "") +
            (r.blocked > 0 ? ` · ${r.blocked} bloqueada(s)` : "") +
            ` · custo $${r.costUsd.toFixed(3)}`,
        )
      } else if (res.status === "blocked_cost_confirmation") {
        toast.error(res.message)
      } else {
        toast.error("message" in res ? res.message : res.error)
      }
    } finally {
      setBatchRunning(false)
      refresh()
    }
  }

  // Fluxo: DRY-RUN obrigatório → mostra contagens + custo (provável/upper bound)
  // → confirmação única → execução. Itens fresh não entram no custo.
  const handlePredictAll = async () => {
    const ids = batchIds
    if (ids.length === 0 || batchRunning) return
    setBatchRunning(true)
    try {
      const planned = await planSynopsisInterestBatchAction(ids)
      if (planned.status !== "ok") {
        toast.error("message" in planned ? planned.message : planned.error)
        return
      }
      const p = planned.plan
      const needCalls = p.stale + p.absent
      if (needCalls === 0) {
        toast.success("Tudo já está atualizado — nada a estimar.")
        return
      }
      const profileNote = p.needsProfile ? " · inclui gerar/atualizar o perfil" : ""
      const maxCostUsd = Math.max(p.upperBoundUsd, 0.01)
      toast(
        `Lote: ${needCalls} previsão(ões)${profileNote}. Custo ~$${p.likelyUsd.toFixed(3)} (provável) / até $${p.upperBoundUsd.toFixed(3)}${remainingAfterBatch > 0 ? ` · ${remainingAfterBatch} restantes` : ""}.`,
        {
          duration: 15000,
          action: {
            label: "Executar",
            onClick: () => {
              void executeBatch(ids, maxCostUsd)
            },
          },
        },
      )
    } finally {
      setBatchRunning(false)
    }
  }

  if (works.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/55 p-8 text-center text-sm text-muted-foreground">
        Nenhuma obra nesse filtro. 🎉
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ordenar:</span>
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger size="sm" className="h-7 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Padrão</SelectItem>
              <SelectItem value="expected">Nota prevista</SelectItem>
              <SelectItem value="lastRead">Última leitura</SelectItem>
              <SelectItem value="predicted">Data da previsão</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            disabled={sortField === "default"}
            title={sortDir === "asc" ? "Crescente" : "Decrescente"}
          >
            {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPaid && applyTargets.length > 0 && (
            <TaskButton
              taskId="apply-synopsis-batch"
              kind="apply-synopsis"
              label={`Aplicar previsão em fila (${applyTargets.length})`}
              busyLabel="Aplicando fila…"
              variant="secondary"
              size="default"
              run={() => applySynopsisPredictionForWorks(applyTargets.map((w) => w.id))}
              formatDone={(r) => {
                const x = r as ApplySynopsisBatchResult
                return {
                  ok: x.applied > 0 || (x.failed === 0 && x.processed > 0),
                  message:
                    `${x.applied} aplicada${x.applied !== 1 ? "s" : ""}` +
                    (x.skipped ? ` · ${x.skipped} pulada(s)` : "") +
                    (x.failed ? ` · ${x.failed} falha(s)` : "") +
                    (x.capped ? " — limitado, rode de novo" : ""),
                }
              }}
            />
          )}
          {isPaid && pendingTargets.length > 0 && (
            <div className="flex items-center gap-2">
              <Select
                value={String(batchSize)}
                onValueChange={(v) => setBatchSize(Number(v))}
                disabled={batchRunning}
              >
                <SelectTrigger size="sm" className="h-9 w-[78px] text-xs" title="Quantas obras por run (teto 100)">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BATCH_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handlePredictAll} disabled={batchRunning || batchIds.length === 0}>
                {batchRunning ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                {batchRunning ? "Processando…" : `Estimar ${batchIds.length} por IA`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sortedWorks.map((w) => {
          const isStale = w.predictedQuality != null && w.predictionStale
          const hasBoth = w.predictedQuality != null && w.manualSynopsisQuality != null
          const alreadyApplied = w.predictedQuality != null && w.manualSynopsisQuality === w.predictedQuality
          const diverges = hasBoth && !alreadyApplied
          const delta = hasBoth ? synopsisLevel(w.predictedQuality) - synopsisLevel(w.manualSynopsisQuality) : null
          return (
            <Card
              key={w.id}
              className="transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10"
            >
              <CardContent className="py-2.5">
                <div className="flex items-center gap-3">
                  <CoverThumb urls={w.coverUrls} />

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <WorkTitleLink
                        title={w.title}
                        workId={w.id}
                        className="text-sm font-semibold hover:underline line-clamp-2 break-words"
                      />
                      {w.expectedScore != null && (
                        <span title="Nota prevista" className="inline-flex shrink-0">
                          <ScoreBadge score={w.expectedScore} size="sm" />
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <PublicationStatusBadge statusId={w.publicationStatusId} />
                      <PersonalStatusBadge statusId={w.personalStatusId} />
                      <span
                        title="Tags da obra"
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                          (w.tagCount ?? 0) === 0
                            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200"
                            : "border-border/60 bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <Tag className="h-3 w-3" />
                        {w.tagCount ?? 0}
                      </span>
                      <span
                        title="Reviews úteis (≥40 chars) que alimentam o digest/previsão"
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                          (w.reviewCount ?? 0) === 0
                            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200"
                            : "border-border/60 bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <MessageSquare className="h-3 w-3" />
                        {w.reviewCount ?? 0}
                      </span>
                      {w.manualSynopsisQuality && (
                        <span
                          title="Interesse na sinopse (manual)"
                          className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300"
                        >
                          {w.manualSynopsisQuality}
                        </span>
                      )}
                      {isStale ? (
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200">
                          desatualizado
                        </span>
                      ) : w.predictedQuality == null ? (
                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300">
                          não previsto
                        </span>
                      ) : null}
                      {!isStale && diverges && (
                        <span
                          title={`Manual ${w.manualSynopsisQuality} ≠ IA ${w.predictedQuality}`}
                          className="inline-flex items-center rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/12 dark:text-orange-200"
                        >
                          diverge
                        </span>
                      )}
                      {!isStale && alreadyApplied && (
                        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-200">
                          bate
                        </span>
                      )}
                    </div>

                    <div className="space-y-0.5">
                      <p className="font-mono text-xs text-muted-foreground tabular-nums">
                        Sugestão IA{w.predictedPromptVersion ? ` (${w.predictedPromptVersion})` : ""}:{" "}
                        {w.predictedQuality != null ? (
                          <span className="font-semibold text-rose-600 dark:text-rose-300">
                            {w.predictedQuality} — {SYNOPSIS_QUALITY_LABELS[w.predictedQuality] ?? ""}
                          </span>
                        ) : (
                          "—"
                        )}
                        {w.predictedConfidence != null && (
                          <span className="ml-1 text-muted-foreground">
                            ({Math.round(w.predictedConfidence * 100)}%)
                          </span>
                        )}
                        {delta != null && (
                          <span
                            title={`IA ${w.predictedQuality} vs manual ${w.manualSynopsisQuality} (${delta > 0 ? "+" : ""}${delta} nível${Math.abs(delta) !== 1 ? "s" : ""})`}
                            className={cn(
                              "ml-1.5 rounded px-1 py-0.5 text-[11px] font-semibold",
                              delta === 0
                                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                : "bg-orange-500/12 text-orange-700 dark:text-orange-300",
                            )}
                          >
                            Δ {delta > 0 ? `+${delta}` : delta}
                          </span>
                        )}
                        {w.predictedAt && (
                          <span className="ml-2 text-muted-foreground/80" title="Data da última previsão">
                            · prevista em {fmtPredictedAt(w.predictedAt)}
                          </span>
                        )}
                      </p>
                      {w.justification && (
                        <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{w.justification}</p>
                      )}
                      <SynopsisInputsPopover
                        canonicalSynopsis={w.canonicalSynopsis}
                        tags={w.tags}
                        reviewDigest={w.reviewDigest}
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2.5">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Interesse
                      </span>
                      <SynopsisQualityPicker workId={w.id} value={w.manualSynopsisQuality} />
                    </div>
                    <PredictSynopsisRowActions
                      workId={w.id}
                      hasPrediction={w.predictedQuality != null}
                      alreadyApplied={alreadyApplied}
                      isPaid={isPaid}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
