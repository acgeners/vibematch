"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Loader2, Sparkles } from "lucide-react"
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
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { rerankWorksBatchAction } from "@/server/actions/recommendations"
import type { AlignmentQueueWork } from "@/server/queries/recommendations"
import { refreshSidebarBadges } from "@/lib/sidebar-badges"

type SortField = "default" | "expected" | "alignment"

/** Opções de tamanho de lote por run (total de obras). */
const BATCH_OPTIONS = [10, 30, 50, 100] as const
const DEFAULT_BATCH_SIZE = 30

/**
 * Obras por CHAMADA ao ranker. Mandar muitos candidatos enriquecidos numa só
 * chamada estoura o orçamento de tokens da resposta (~280/candidato; 30 já
 * trunca em max_tokens e o modelo passa a devolver work_ids inválidos → 0 notas).
 * 10 por chamada fica bem dentro da faixa confiável (a run normal de
 * recomendação usa 10–20) e isola falhas. Lotes maiores rodam em vários blocos.
 */
const PER_CALL_CHUNK = 10

/**
 * Fila de IA Rk (aba /ai-evaluation?tab=ia-rk): obras desatualizadas (re-rank
 * velho) e/ou não avaliadas (sem IA Rk). Mesmo layout de cards da aba de
 * atributos. O botão de lote cobre TODA a fila visível (desatualizados + não
 * avaliados) até `batchSize` por run, em blocos pra mostrar progresso; item a
 * item usa o RerankAiRkButton.
 */
export function StaleRerankPanel({
  works,
  isPaid = true,
}: {
  works: AlignmentQueueWork[]
  isPaid?: boolean
}) {
  const router = useRouter()
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_BATCH_SIZE)
  const [batchRunning, setBatchRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const sortedWorks = useMemo(() => {
    if (sortField === "default") {
      // Desatualizados primeiro, depois não avaliados; cada grupo por título.
      return [...works].sort((a, b) => {
        const aStale = a.alignmentStale && a.alignmentScore != null ? 0 : 1
        const bStale = b.alignmentStale && b.alignmentScore != null ? 0 : 1
        if (aStale !== bStale) return aStale - bStale
        return a.title.localeCompare(b.title, "pt-BR")
      })
    }
    const key = (w: AlignmentQueueWork) =>
      sortField === "expected" ? w.expectedScore : w.alignmentScore
    const mult = sortDir === "asc" ? 1 : -1
    return [...works].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      // Nulos sempre no fim, independente da direção.
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  // Alvos do lote = todas as obras VISÍVEIS na fila (todas precisam de re-rank:
  // desatualizadas ou não avaliadas), na ordem exibida, cortadas em batchSize.
  // Garante que "Calcular N" age sobre os cards que o usuário está vendo.
  const batchIds = sortedWorks.slice(0, batchSize).map((w) => w.id)
  const remainingAfterBatch = Math.max(sortedWorks.length - batchIds.length, 0)

  // Cada bloco vira UMA chamada rankFavorites; processar em blocos pequenos
  // mantém a resposta dentro do orçamento de tokens (sem truncar) e exibe
  // progresso (X/total) entre eles.
  const handleRerankAll = async () => {
    const ids = batchIds
    if (ids.length === 0 || batchRunning) return
    const total = ids.length
    setBatchRunning(true)
    setProgress({ done: 0, total })
    let ranked = 0
    let failed = 0
    let aborted = false
    try {
      for (let i = 0; i < ids.length; i += PER_CALL_CHUNK) {
        const chunk = ids.slice(i, i + PER_CALL_CHUNK)
        const result = await rerankWorksBatchAction(chunk)
        if (result.error || !result.data) {
          toast.error(result.error ?? "Erro ao re-rankear.")
          aborted = true
          break
        }
        ranked += result.data.ranked
        failed += result.data.failed
        setProgress({ done: Math.min(i + PER_CALL_CHUNK, total), total })
      }
    } finally {
      setBatchRunning(false)
      setProgress(null)
    }
    if (!aborted) {
      toast.success(
        `${ranked} re-rankeada${ranked !== 1 ? "s" : ""}` +
          (failed > 0 ? ` · ${failed} falhou` : "") +
          (remainingAfterBatch > 0 ? ` · ${remainingAfterBatch} restantes` : "."),
      )
    }
    router.refresh()
    refreshSidebarBadges() // re-rank mudou a fila "IA Rk stale" → recontar badge
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
              <SelectItem value="alignment">IA Rk</SelectItem>
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

        {isPaid && sortedWorks.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={String(batchSize)}
              onValueChange={(v) => setBatchSize(Number(v))}
              disabled={batchRunning}
            >
              <SelectTrigger size="sm" className="h-9 w-[78px] text-xs" title="Quantas obras por run">
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
            <Button onClick={handleRerankAll} disabled={batchRunning || batchIds.length === 0}>
              {batchRunning ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              {batchRunning
                ? progress
                  ? `Re-rankeando… ${progress.done}/${progress.total}`
                  : "Re-rankeando…"
                : `Calcular ${batchIds.length} por IA`}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sortedWorks.map((w) => {
          const isStale = w.alignmentStale && w.alignmentScore != null
          return (
            <Card
              key={w.id}
              className="transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10"
            >
              <CardContent className="py-2.5">
                <div className="flex items-center gap-3">
                  {/* Capa (esquerda) — aspect 2:3 de manga */}
                  <CoverThumb urls={w.coverUrls} />

                  {/* Conteúdo central */}
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
                      {w.synopsisQuality && (
                        <span
                          title="Interesse na sinopse"
                          className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300"
                        >
                          {w.synopsisQuality}
                        </span>
                      )}
                      {isStale ? (
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200">
                          desatualizado
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300">
                          não avaliado
                        </span>
                      )}
                    </div>

                    <p className="font-mono text-xs text-muted-foreground tabular-nums">
                      IA Rk: {w.alignmentScore != null ? Math.round(w.alignmentScore) : "—"}
                    </p>
                  </div>

                  {/* Ações (direita) */}
                  <div className="flex shrink-0 flex-col items-stretch gap-2.5">
                    <RerankAiRkButton workId={w.id} hasScore={w.alignmentScore != null} />
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
