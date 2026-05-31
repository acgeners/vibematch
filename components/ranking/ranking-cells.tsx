"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Sparkles, RotateCw } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"

/**
 * Hook compartilhado pelo re-rank de uma obra. Dispara `rerankSingleWorkAction`
 * (1 LLM call), avisa via toast e força refresh dos server components pra a cell
 * renderizar o badge atualizado.
 */
function useRerankSingleWork(workId: string) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const run = () => {
    startTransition(async () => {
      const result = await rerankSingleWorkAction(workId)
      if (result.error || !result.data) {
        toast.error(result.error ?? "Erro ao rankear obra.")
        return
      }
      toast.success(`IA Rk: ${Math.round(result.data.alignmentScore)}`)
      router.refresh()
    })
  }
  return { isPending, run }
}

/**
 * Botão pequeno que substitui o "—" da `AlignmentScoreCell` quando há um
 * `workId` mas ainda não há nota (primeiro re-rank da obra).
 */
function RerankSingleWorkButton({ workId }: { workId: string }) {
  const { isPending, run } = useRerankSingleWork(workId)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={run}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-violet-500/60 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-50 disabled:cursor-wait"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span>{isPending ? "..." : "Rankear"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Rodar IA re-rank só pra esta obra. Conta uma execução do limite diário.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Ícone ⟳ clicável ao lado da nota quando o IA Rk está DESATUALIZADO. Roda o
 * re-rank só desta obra (mesma action do "Rankear"), limpando o stale.
 */
function RerankStaleButton({ workId }: { workId: string }) {
  const { isPending, run } = useRerankSingleWork(workId)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              run()
            }}
            disabled={isPending}
            aria-label="Atualizar IA Rk (desatualizado)"
            className="inline-flex items-center justify-center rounded p-0.5 text-amber-500 hover:bg-amber-500/10 hover:text-amber-600 disabled:cursor-wait disabled:opacity-50 dark:hover:text-amber-400"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Desatualizado — a obra mudou desde este re-rank. Clique pra rodar o IA re-rank
          só desta obra. Conta uma execução do limite diário.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `alignment_score` (0–100) — badge azul/violet com tooltip da
 * justificativa do LLM. NULL vira "—" (obra ainda não passou pelo re-rank);
 * se `workId` está presente, vira um botão "Rankear" que dispara o re-rank
 * inline pra aquela obra.
 */
/** Payload enriquecido (sub-fase 2.3.A — Smart Shortlist v2+). */
export interface AlignmentPayload {
  confidence?: number
  risks?: string[]
  similar_loved?: string[]
  similar_avoided?: string[]
  review_quotes?: string[]
  mood_fit?: number
}

export function AlignmentScoreCell({
  score,
  justification,
  workId,
  payload,
  isPaid = true,
  stale = false,
}: {
  score: number | null
  justification: string | null
  workId?: string
  payload?: AlignmentPayload | null
  isPaid?: boolean
  /** True quando o IA Rk ficou desatualizado (obra editada/re-avaliada). */
  stale?: boolean
}) {
  if (score == null) {
    if (workId && isPaid) {
      return <RerankSingleWorkButton workId={workId} />
    }
    if (workId && !isPaid) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-xs text-muted-foreground/70 cursor-help">
                <Sparkles className="h-3 w-3" />
                <span>Pago</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              O re-rank por IA (IA Rk) é uma feature do plano Pago. No Free o ranking usa
              Nota Prevista × alinhamento.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px]">
            Esta obra ainda não passou pelo IA re-rank. Use o botão &quot;Recomendar do
            ranking&quot; aqui no topo da página pra incluí-la numa run — o
            <span className="font-semibold"> alignment_score</span> retornado fica salvo
            nessa coluna.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const colorClass =
    score >= 80 ? "bg-violet-500/15 text-violet-700 border-violet-500/40 dark:text-violet-300"
    : score >= 60 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
    : score >= 40 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
    : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"

  const hasEnriched = Boolean(
    payload && (
      payload.confidence != null ||
      (payload.risks?.length ?? 0) > 0 ||
      (payload.similar_loved?.length ?? 0) > 0 ||
      (payload.similar_avoided?.length ?? 0) > 0 ||
      (payload.review_quotes?.length ?? 0) > 0 ||
      payload.mood_fit != null
    ),
  )

  // Confidence dot: indicador visual sutil ao lado do score. Verde = ≥0.75 (alta),
  // âmbar = 0.5-0.75 (média), cinza = <0.5 (baixa). Omitido quando ausente.
  const confidenceDot = payload?.confidence != null
    ? payload.confidence >= 0.75 ? "bg-emerald-500"
    : payload.confidence >= 0.5 ? "bg-amber-500"
    : "bg-slate-400"
    : null

  // Quando desatualizado e o re-rank é possível (Pago + workId), o ⟳ vira um
  // botão clicável ao lado do badge. Senão, fica como indicador estático dentro
  // do badge (Free ou sem workId).
  const canRerankStale = stale && !!workId && isPaid

  return (
    <span className="inline-flex items-center gap-1">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium cursor-help tabular-nums",
              colorClass,
              stale && "opacity-60",
            )}
          >
            {confidenceDot && (
              <span
                className={cn("h-1.5 w-1.5 rounded-full", confidenceDot)}
                title={`Confiança: ${(payload!.confidence! * 100).toFixed(0)}%`}
              />
            )}
            {Math.round(score)}
            {stale && !canRerankStale && (
              <RotateCw className="h-3 w-3 text-amber-500" aria-label="Desatualizado" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[400px] space-y-1.5">
          {stale && (
            <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <RotateCw className="h-3 w-3" />
              Desatualizado — a obra mudou desde este re-rank. Rode o IA re-rank de novo pra atualizar.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-xs">IA Re-rank: {Math.round(score)}/100</p>
            {payload?.confidence != null && (
              <span className="text-[10px] text-muted-foreground">
                Confiança: <span className="font-semibold text-foreground">{(payload.confidence * 100).toFixed(0)}%</span>
              </span>
            )}
          </div>
          {payload?.mood_fit != null && (
            <p className="text-[10px] text-muted-foreground">
              Fit com mood: <span className="font-mono font-semibold text-foreground">{(payload.mood_fit * 100).toFixed(0)}%</span>
            </p>
          )}
          {justification && <p className="text-xs leading-relaxed">{justification}</p>}
          {hasEnriched && (
            <div className="border-t border-border/40 pt-1.5 space-y-1.5">
              {payload?.risks && payload.risks.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">⚠ Riscos</p>
                  <ul className="mt-0.5 text-xs space-y-0.5">
                    {payload.risks.map((r, i) => (
                      <li key={i} className="leading-snug">• {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {payload?.review_quotes && payload.review_quotes.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reviews citadas</p>
                  <ul className="mt-0.5 text-xs italic space-y-0.5">
                    {payload.review_quotes.map((q, i) => (
                      <li key={i} className="leading-snug">&ldquo;{q}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              )}
              {payload?.similar_loved && payload.similar_loved.length > 0 && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  Lembra de obras que você ama ({payload.similar_loved.length} similar{payload.similar_loved.length > 1 ? "es" : ""})
                </p>
              )}
              {payload?.similar_avoided && payload.similar_avoided.length > 0 && (
                <p className="text-[10px] text-rose-600 dark:text-rose-400">
                  Lembra de obras que você não curtiu ({payload.similar_avoided.length})
                </p>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
      {canRerankStale && <RerankStaleButton workId={workId!} />}
    </span>
  )
}

/**
 * Cell pra a Nota Final (0–10) — número de PRIORIDADE que combina Prevista,
 * Alinhamento e (quando há) IA Rk. Distinta visualmente das outras notas (tom
 * primary) porque é o critério default de ordenação. O tooltip abre a composição
 * pra deixar claro que NÃO é uma previsão de nota, e sim "o que ler primeiro".
 */
export function DecisionCell({
  score,
  expected,
  fitPercentile,
  alignment,
}: {
  score: number | null
  expected: number | null
  fitPercentile: number | null
  alignment: number | null
}) {
  if (score == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            Sem Nota Final — depende da Nota Prevista, que ainda não foi calculada pra esta obra.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const colorClass =
    score >= 8 ? "bg-primary/15 text-primary border-primary/40"
    : score >= 6 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
    : score >= 4 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
    : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-sm font-bold cursor-help tabular-nums",
              colorClass,
            )}
          >
            {score.toFixed(1)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px] space-y-1.5">
          <p className="text-xs font-semibold">Nota Final: {score.toFixed(1)}/10</p>
          <p className="text-[11px] text-muted-foreground">
            Prioridade pra escolher o que ler primeiro — combina as notas abaixo.
            <span className="font-semibold"> Não é uma previsão de nota</span> (essa é a Prevista).
          </p>
          <div className="border-t border-border/40 pt-1.5 space-y-0.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Prevista (âncora)</span>
              <span className="font-mono font-semibold">{expected != null ? expected.toFixed(1) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Alinhamento (±10%)</span>
              <span className="font-mono font-semibold">{fitPercentile != null ? `${Math.round(fitPercentile)}%` : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">IA Rk. (quando há)</span>
              <span className="font-mono font-semibold">{alignment != null ? Math.round(alignment) : "não rankeada"}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `personal_fit` — agora mostra o PERCENTIL dentro da biblioteca
 * (0-100) em vez do valor cru. O personal_fit cru tem teto matemático
 * baixo (~0.55 mesmo nas melhores obras), então "55%" lê como mediano
 * quando na verdade é o topo. Percentil comunica "Top X%" e é mais honesto.
 *
 * Fallback pro valor cru quando percentile é NULL (pré-migration 071 ou
 * perfil stub).
 */
export function AlignmentCell({
  value,
  percentile,
  showBar = true,
}: {
  value: number | null
  /** Percentil (0-100) dentro da biblioteca. Quando presente, usado como display. */
  percentile?: number | null
  /** Quando false, mostra só o número colorido por faixa (sem a barra). */
  showBar?: boolean
}) {
  if (value == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            Sem alinhamento computado — perfil de gosto ainda é stub ou a obra não tem critérios/tags
            que casem com o perfil.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Display preference: percentile (mais honesto) > valor cru (fallback)
  const displayPct = percentile != null ? Math.round(percentile) : Math.round(value * 100)
  const rawPct = Math.round(value * 100)
  const color =
    displayPct >= 75 ? "bg-emerald-500"
    : displayPct >= 50 ? "bg-amber-500"
    : displayPct >= 25 ? "bg-orange-500"
    : "bg-slate-400"
  // Versão text-only (showBar=false): mesma faixa do bar mapeada pra cor de texto.
  const textColor =
    displayPct >= 75 ? "text-emerald-600 dark:text-emerald-400"
    : displayPct >= 50 ? "text-amber-600 dark:text-amber-400"
    : displayPct >= 25 ? "text-orange-600 dark:text-orange-400"
    : "text-muted-foreground"

  // Top label quando estamos exibindo percentile
  const topLabel =
    percentile == null ? null
    : percentile >= 95 ? "Top 5%"
    : percentile >= 90 ? "Top 10%"
    : percentile >= 75 ? "Top 25%"
    : percentile >= 50 ? "Acima da mediana"
    : percentile >= 25 ? "Abaixo da mediana"
    : "Bottom 25%"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {showBar ? (
            <div className="inline-flex items-center gap-1.5 cursor-help">
              <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full transition-all", color)} style={{ width: `${displayPct}%` }} />
              </div>
              <span className="font-mono text-xs tabular-nums">{displayPct}%</span>
            </div>
          ) : (
            <span className={cn("font-mono text-xs font-medium tabular-nums cursor-help", textColor)}>
              {displayPct}%
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] space-y-1">
          {percentile != null ? (
            <>
              <p className="text-xs font-semibold">{topLabel} da sua biblioteca</p>
              <p className="text-[11px] text-muted-foreground">
                Alinhamento bruto: <span className="font-mono">{rawPct}%</span> (escala 0–55% típica).
                Percentil mostra onde essa obra está RELATIVO ao resto da sua biblioteca — mais
                honesto que o valor cru, que tem teto matemático baixo.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs">Alinhamento determinístico com seu perfil de gosto.</p>
              <p className="text-[11px] text-muted-foreground">
                Combina tags amadas/evitadas (40%), faixas ideais de critério (30%) e consistência
                geral (30%). Re-rode o cálculo pra ganhar a versão percentil (Top X%).
              </p>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

