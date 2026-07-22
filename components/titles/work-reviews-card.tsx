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
import { isDigestCorrupted } from "@/lib/ai-recommendation/digest-integrity"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"

interface WorkReviewsCardProps {
  snapshot: WorkReviewsSnapshot
  workId: string
}

// Reviews abaixo disto não geram resumo (espelha review-summarizer.ts e settings-pending.ts).
const MIN_SUMMARY_CHARS = 40

// `border-<cor>` não pinta neste app: o `* { border-color }` de globals.css vence a utility.
// Contorno colorido só sai com `ring-*`.
function polarityChipClass(p: string): string {
  return p === "positive"
    ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300"
    : p === "negative"
      ? "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300"
      : "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300"
}

// Ordem-espectro e rótulo de cada polaridade. `mixed` (e qualquer valor inesperado)
// cai no balde do meio, espelhando o fallback de polarityChipClass. Só text-*: `border-<cor>`
// não pinta neste app (ver polarityChipClass acima).
const POLARITY_GROUPS = [
  { key: "positive", label: "Positivo", labelClass: "text-emerald-700 dark:text-emerald-300" },
  { key: "mixed", label: "Misto", labelClass: "text-amber-700 dark:text-amber-300" },
  { key: "negative", label: "Negativo", labelClass: "text-rose-700 dark:text-rose-300" },
] as const

/** Traços salientes como chips, agrupados por polaridade (positivo → misto → negativo). */
function TraitChips({ traits }: { traits: ReviewDigest["salient_traits"] }) {
  const groups: Record<(typeof POLARITY_GROUPS)[number]["key"], ReviewDigest["salient_traits"]> = {
    positive: [],
    mixed: [],
    negative: [],
  }
  for (const t of traits) {
    const key = t.polarity === "positive" ? "positive" : t.polarity === "negative" ? "negative" : "mixed"
    groups[key].push(t)
  }

  return (
    <div className="flex flex-col gap-2">
      {POLARITY_GROUPS.map(({ key, label, labelClass }) =>
        groups[key].length === 0 ? null : (
          // Seção some sozinha quando não há traço daquela polaridade.
          <div key={key} className="grid grid-cols-[64px_1fr] items-start gap-2.5">
            <span className={cn("pt-1 text-[10px] font-semibold uppercase tracking-wider", labelClass)}>
              {label}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {groups[key].map((t, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px]",
                    polarityChipClass(t.polarity),
                  )}
                  title={t.axis || undefined}
                >
                  <span className="size-1 rounded-full bg-current" aria-hidden />
                  {t.trait}
                </span>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

/** Campo secundário do digest (divergência / execução): rotulado e subordinado ao consenso. */
function DigestField({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-1 bg-muted/40 p-3">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-[13.5px] leading-relaxed text-foreground/90">{children}</span>
    </div>
  )
}

/** Resumo em prosa (Haiku): a mesma síntese em texto corrido, fechada por padrão. */
function ProseDisclosure({ summary, summaryAt }: { summary: string; summaryAt: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        Ler o resumo em prosa
        {summaryAt && <span className="text-[11px] text-muted-foreground/70">· {formatRelativeDateTime(summaryAt)}</span>}
      </button>
      {open && (
        <p className="mt-2.5 whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
          {summary}
        </p>
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
        toast.error(res.message ?? "Falha ao destilar as reviews.")
        return
      }
      if (res.status === "generated") {
        toast.success(`Síntese gerada${res.costUsd ? ` (~$${res.costUsd.toFixed(3)})` : ""}.`)
      } else if (res.status === "fresh") {
        toast.info("Síntese já está em dia.")
      } else if (res.status === "processing") {
        toast.info("Geração em andamento.")
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
              <CardTitle className="text-base">O que dizem as reviews</CardTitle>
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
  // Reviews existem, mas nenhuma alcança o mínimo do resumidor → o resumo nunca é
  // gerado (fica `no_content`). Some sozinho quando entrar uma review ≥ 40 chars.
  const noSummarizableReview =
    !snapshot.summary && shortReviews.length > 0 && shortReviews.every((r) => r.len < MIN_SUMMARY_CHARS)

  const digest = snapshot.digest
  const corrupted = digest != null && isDigestCorrupted(digest)
  // Digest íntegro E com consenso: só então ele pode ser a cara do painel. Sem
  // consenso não há frase de abertura, e a prosa (se houver) serve melhor.
  const digestLeads = digest != null && !corrupted && Boolean(digest.consensus?.trim())
  const synthesizedAt = digestLeads ? snapshot.digestAt : snapshot.summaryAt
  const totalReviews = snapshot.total + snapshot.manual.length
  // Fontes = união das raspadas com as das manuais. Contar só `bySource` sub-reporta:
  // uma review manual de uma fonte que nunca foi raspada não aparecia na contagem.
  const sourceCount = new Set<string>([
    ...snapshot.bySource.map((s) => s.source),
    ...snapshot.manual.map((r) => r.source),
  ]).size

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">O que dizem as reviews</CardTitle>
            <Badge variant="outline" className="text-[11px] tabular-nums">
              {totalReviews} review{totalReviews === 1 ? "" : "s"}
              {sourceCount > 0 && ` · ${sourceCount} fonte${sourceCount === 1 ? "" : "s"}`}
            </Badge>
            {snapshot.manual.length > 0 && (
              <Badge
                variant="secondary"
                className="gap-1 text-[11px] tabular-nums"
                title="Reviews externas adicionadas à mão, já incluídas no total"
              >
                <PenLine className="h-3 w-3" />
                {snapshot.manual.length} {snapshot.manual.length === 1 ? "manual" : "manuais"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {synthesizedAt && (
              <span className="text-[11px] text-muted-foreground">
                sintetizado {formatRelativeDateTime(synthesizedAt)}
              </span>
            )}
            {digest != null && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                disabled={generating}
                onClick={() => void runGenerate(true)}
                title={
                  snapshot.digestN != null
                    ? `Refaz a síntese estruturada a partir das reviews atuais (${snapshot.digestN} entraram na última; custo Sonnet ~$0,02–0,05). Não regera o resumo em prosa.`
                    : "Refaz a síntese estruturada a partir das reviews atuais (custo Sonnet ~$0,02–0,05). Não regera o resumo em prosa."
                }
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Regerar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        {digestLeads && digest ? (
          <>
            {/* O consenso É a resposta — abre o painel sem rótulo, em corpo maior. */}
            <p className="text-[16.5px] leading-snug text-foreground">{digest.consensus}</p>

            {digest.salient_traits?.length > 0 && <TraitChips traits={digest.salient_traits} />}

            {(digest.divergence?.trim() || digest.execution?.trim()) && (
              <div className="grid gap-px overflow-hidden rounded-md bg-border sm:grid-cols-2">
                {digest.divergence?.trim() && (
                  <DigestField label="Onde discordam">{digest.divergence}</DigestField>
                )}
                {digest.execution?.trim() && (
                  <DigestField label="Execução">{digest.execution}</DigestField>
                )}
              </div>
            )}

            {digest.content_warnings?.length > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs text-muted-foreground ring-1 ring-amber-500/30">
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">Avisos de conteúdo:</span>{" "}
                  {digest.content_warnings.join(" · ")}
                </span>
              </div>
            )}

            {snapshot.summary && (
              <ProseDisclosure summary={snapshot.summary} summaryAt={snapshot.summaryAt} />
            )}
          </>
        ) : (
          <>
            {/* Digest corrompido (tool-call mal-serializado): renderizar isso engana mais
                do que informa. A prosa abaixo, se houver, mantém a obra falando. */}
            {corrupted && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-muted-foreground ring-1 ring-amber-500/30">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  A síntese estruturada foi gerada com uma resposta corrompida do modelo e não pode
                  ser exibida. Use <span className="font-medium text-foreground">Regerar</span> para refazê-la.
                </span>
              </div>
            )}

            {snapshot.summary && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {snapshot.summary}
              </p>
            )}

            {/* Sem digest utilizável: convida a destilar, dizendo o que isso acrescenta. */}
            {!corrupted && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                  {snapshot.summary
                    ? "Destile em traços, divergências e avisos — é o que alimenta o Interesse e o Veredito."
                    : "Sem síntese. Destila as reviews (consenso, traços, avisos) e alimenta a IA (Interesse / Veredito)."}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={generating}
                  onClick={() => void runGenerate(false)}
                  title="Destila as reviews em consenso, traços e avisos (custo Sonnet ~$0,02–0,05)"
                >
                  {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {snapshot.summary ? "Destilar" : "Sintetizar reviews"}
                </Button>
              </div>
            )}
          </>
        )}

        {noSummarizableReview && (
          <div className="rounded-md bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-foreground">Sem síntese — reviews curtas demais</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              A(s) review(s) desta obra têm texto curto demais (menos de {MIN_SUMMARY_CHARS} caracteres)
              para gerar uma síntese. Busque mais reviews ou adicione uma review externa maior.
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {shortReviews.slice(0, 5).map((r, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline gap-2 rounded border bg-background/40 px-2 py-1.5 text-xs text-muted-foreground"
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
        )}
      </CardContent>

      {/* As reviews cruas ficam onde sempre estiveram — atrás de um clique, agora explícito. */}
      <div className="border-t bg-muted/30">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex flex-wrap items-center gap-2">
            {expanded ? "Ocultar as reviews" : `Ver as ${totalReviews} review${totalReviews === 1 ? "" : "s"}`}
            {snapshot.manual.length > 0 && (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <PenLine className="h-3 w-3" />
                {snapshot.manual.length} {snapshot.manual.length === 1 ? "manual" : "manuais"}
              </Badge>
            )}
            {snapshot.fetchedAt && (
              <span className="text-[11px] text-muted-foreground/70">
                buscadas {formatRelativeDateTime(snapshot.fetchedAt)}
              </span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded && (
        <CardContent className="space-y-5 pt-5">
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
                    className="rounded-md bg-primary/5 p-3 ring-1 ring-primary/20"
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
