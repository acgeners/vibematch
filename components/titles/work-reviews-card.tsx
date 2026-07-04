"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, ChevronDown, Layers, Loader2, MessageSquareText, PenLine, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpandableText } from "@/components/ui/expandable-text"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"

interface WorkReviewsCardProps {
  snapshot: WorkReviewsSnapshot
  workId: string
}

function digestPolarityClass(p: string): string {
  return p === "positive"
    ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
    : p === "negative"
      ? "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
      : "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
}

/** Corpo estruturado do digest: consenso, divergência, execução, traços (chips por polaridade), avisos. */
function DigestBody({ digest }: { digest: ReviewDigest }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
      {digest.consensus?.trim() && (
        <p><span className="font-semibold text-foreground">Consenso:</span> {digest.consensus}</p>
      )}
      {digest.divergence?.trim() && (
        <p><span className="font-semibold text-foreground">Divergências:</span> {digest.divergence}</p>
      )}
      {digest.execution?.trim() && (
        <p><span className="font-semibold text-foreground">Execução:</span> {digest.execution}</p>
      )}
      {digest.salient_traits?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {digest.salient_traits.map((t, i) => (
            <Badge key={i} variant="outline" className={cn("text-[11px] font-normal", digestPolarityClass(t.polarity))} title={t.axis || undefined}>
              {t.trait}
            </Badge>
          ))}
        </div>
      )}
      {digest.content_warnings?.length > 0 && (
        <p className="text-xs text-muted-foreground"><span className="font-semibold">Avisos:</span> {digest.content_warnings.join(" · ")}</p>
      )}
    </div>
  )
}

function ratingColor(rating: number | null): string {
  if (rating == null) return "text-muted-foreground"
  if (rating >= 8) return "text-emerald-600 dark:text-emerald-300"
  if (rating >= 6) return "text-lime-600 dark:text-lime-300"
  if (rating >= 4) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

export function WorkReviewsCard({ snapshot, workId }: WorkReviewsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const [generating, startGenerate] = useTransition()

  const runGenerate = async (force: boolean) => {
    if (!(await confirmCost({ action: "review_digest" }))) return
    startGenerate(async () => {
      const res = await generateWorkReviewDigest(workId, { force })
      if (!res.ok) {
        toast.error(res.message ?? "Falha ao gerar o digest.")
        return
      }
      if (res.status === "generated") {
        toast.success(`Digest gerado${res.costUsd ? ` (~$${res.costUsd.toFixed(3)})` : ""}.`)
      } else if (res.status === "fresh") {
        toast.info("Digest já está em dia.")
      } else if (res.status === "processing") {
        toast.info("Geração do digest em andamento.")
      } else {
        toast.info(res.message ?? "Concluído.")
      }
      refresh()
    })
  }

  if (snapshot.total === 0 && snapshot.manual.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Reviews</CardTitle>
            </div>
            <Badge variant="outline" className="text-[11px]">0 reviews</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhuma review salva ainda. Reviews externas são extraídas quando a
            Avaliação IA é executada; reviews externas também podem ser adicionadas
            à mão na edição da obra (ambiente local).
          </p>
        </CardContent>
      </Card>
    )
  }

  // Reviews existem, mas NENHUMA chega ao mínimo do resumidor (< 40 chars) → o
  // resumo nunca é gerado (fica `no_content`). Espelha o limiar de
  // review-summarizer.ts e da contagem de pendentes (settings-pending.ts). Só
  // avisa quando não há resumo salvo — some sozinho quando entrar uma review ≥ 40.
  const MIN_SUMMARY_CHARS = 40
  const shortReviews = [
    ...snapshot.bySource.flatMap((s) =>
      s.reviews.map((r) => ({
        label: PLATFORM_LABELS[s.source] ?? s.source,
        text: r.text,
        len: r.textLength ?? r.text.length,
      })),
    ),
    ...snapshot.manual.map((r) => ({
      label: PLATFORM_LABELS[r.source] ?? r.source,
      text: r.text,
      len: r.text.trim().length,
    })),
  ]
  const noSummarizableReview =
    !snapshot.summary && shortReviews.length > 0 && shortReviews.every((r) => r.len < MIN_SUMMARY_CHARS)

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Reviews</CardTitle>
            {snapshot.total > 0 && (
              <Badge variant="outline" className="text-[11px]">
                {snapshot.total} de {snapshot.bySource.length} fonte(s)
              </Badge>
            )}
            {snapshot.manual.length > 0 && (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <PenLine className="h-3 w-3" />
                {snapshot.manual.length} manual{snapshot.manual.length === 1 ? "" : "is"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {snapshot.fetchedAt && (
              <span className="text-xs text-muted-foreground">
                buscado em {formatRelativeDateTime(snapshot.fetchedAt)}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </div>
        </button>
      </CardHeader>
      {snapshot.summary && (
        <CardContent className="pb-3 pt-0">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Resumo das reviews (IA)</span>
              {snapshot.summaryAt && (
                <span className="text-[11px] text-muted-foreground">
                  · {formatRelativeDateTime(snapshot.summaryAt)}
                </span>
              )}
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {snapshot.summary}
            </p>
          </div>
        </CardContent>
      )}
      {noSummarizableReview && (
        <CardContent className="pb-3 pt-0">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-foreground">Sem resumo — reviews curtas demais</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              A(s) review(s) desta obra têm texto curto demais (menos de {MIN_SUMMARY_CHARS} caracteres)
              para gerar um resumo. Busque mais reviews ou adicione uma review externa maior.
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {shortReviews.slice(0, 5).map((r, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline gap-2 rounded border border-border/60 bg-background/40 px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="font-semibold text-foreground/90">{r.label}</span>
                  <span className="line-clamp-1 max-w-[24rem] italic text-muted-foreground">
                    “{r.text.trim()}”
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-amber-600 dark:text-amber-400">
                    {r.len} car.
                  </span>
                </li>
              ))}
              {shortReviews.length > 5 && (
                <li className="text-[11px] text-muted-foreground">+{shortReviews.length - 5} mais</li>
              )}
            </ul>
          </div>
        </CardContent>
      )}
      {snapshot.digest ? (
        <CardContent className="pb-3 pt-0">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-semibold text-foreground">Digest de reviews (IA)</span>
                {snapshot.digestN != null && (
                  <Badge variant="outline" className="text-[11px]">{snapshot.digestN} reviews</Badge>
                )}
                {snapshot.digestAt && (
                  <span className="text-[11px] text-muted-foreground">· {formatRelativeDateTime(snapshot.digestAt)}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                disabled={generating}
                onClick={() => void runGenerate(true)}
                title="Regenera o digest a partir das reviews atuais (custo Sonnet ~$0,02–0,05)"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Regerar
              </Button>
            </div>
            <DigestBody digest={snapshot.digest} />
          </div>
        </CardContent>
      ) : (snapshot.total > 0 || snapshot.manual.length > 0) ? (
        <CardContent className="pb-3 pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layers className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Sem digest. Destila as reviews (consenso, traços, avisos) e alimenta a IA (Interesse / Veredito).
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              disabled={generating}
              onClick={() => void runGenerate(false)}
              title="Gera o digest a partir das reviews (custo Sonnet ~$0,02–0,05)"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Gerar digest
            </Button>
          </div>
        </CardContent>
      ) : null}
      {expanded && (
        <CardContent className="space-y-5">
          {snapshot.manual.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <PenLine className="h-3.5 w-3.5 text-primary" />
                  Reviews externas (manuais)
                </h3>
                <span className="text-xs text-muted-foreground">
                  {snapshot.manual.length} review(s)
                </span>
              </div>
              <ul className="space-y-2">
                {snapshot.manual.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-md border border-primary/30 bg-primary/5 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold">{PLATFORM_LABELS[review.source] ?? review.source}</span>
                    </div>
                    <ExpandableText
                      text={review.text}
                      maxLines={4}
                      className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {snapshot.bySource.map(({ source, reviews }) => (
            <section key={source}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {PLATFORM_LABELS[source] ?? source}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {reviews.length} review(s)
                </span>
              </div>
              <ul className="space-y-2">
                {reviews.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-md border bg-card/40 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <div className="flex items-baseline gap-2">
                        {review.sourceTitle && (
                          <span
                            className="line-clamp-1 max-w-[28rem] text-muted-foreground"
                            title={review.sourceTitle}
                          >
                            <span className="text-foreground/70">como </span>“{review.sourceTitle}”
                          </span>
                        )}
                        <Badge variant="outline" className="text-[11px]">
                          match {Math.round(review.matchScore * 100)}%
                        </Badge>
                      </div>
                      {review.userRating != null && (
                        <span
                          className={cn(
                            "font-mono font-semibold tabular-nums",
                            ratingColor(review.userRating),
                          )}
                        >
                          {review.userRating.toFixed(1)}/10
                        </span>
                      )}
                    </div>
                    <ExpandableText
                      text={review.text}
                      maxLines={4}
                      className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
