"use client"

import { useMemo, useState, useTransition } from "react"
import type { ComponentType } from "react"
import { AlertTriangle, ArrowLeftRight, ChevronDown, Layers, Loader2, MessageSquareText, PenLine, RefreshCw, Sparkles, Users } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpandableText } from "@/components/ui/expandable-text"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import { isDigestCorrupted } from "@/lib/ai-recommendation/digest-integrity"
import { RefetchReviewsButton } from "@/components/titles/refetch-reviews-button"
import { AiProvenanceSeal, formatProvenanceDate } from "@/components/ui/ai-provenance"
import {
  collectUserRatings,
  defaultAxisKey,
  describeRatings,
  groupTraitsByAxis,
  ratingHistogram,
  reviewSignal,
} from "@/lib/reviews/digest-view"
import type { AxisGroup, RatingBin } from "@/lib/reviews/digest-view"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"
import { formatUsdApprox } from "@/lib/format/money"

interface WorkReviewsCardProps {
  snapshot: WorkReviewsSnapshot
  workId: string
  /**
   * Modelo de cada uma das DUAS gerações deste card. Nem `review_digest` nem
   * `review_summary` têm coluna de modelo em `works` — vem do log central, e é
   * `null` pra obra anterior a 03/07/2026 (ver server/queries/ai-provenance.ts).
   * As datas, essas sim, saem do snapshot.
   */
  provenance?: {
    digestModel: string | null
    digestPromptVersion?: string | null
    summaryModel: string | null
  }
}

// Reviews abaixo disto não geram resumo (espelha review-summarizer.ts e settings-pending.ts).
const MIN_SUMMARY_CHARS = 40

// `border-<cor>` não pinta neste app: o `* { border-color }` de globals.css vence a utility.
// Contorno colorido só sai com `ring-*`. A polaridade "neutra" (ressalva) é SLATE de propósito —
// se fosse amber, se confundiria com o aviso de conteúdo, que passa ideia sem relação.
const TONE_TEXT: Record<string, string> = {
  positive: "text-emerald-600 dark:text-emerald-300",
  negative: "text-rose-600 dark:text-rose-300",
  mixed: "text-slate-500 dark:text-slate-300",
}
const TONE_DOT: Record<string, string> = {
  positive: "bg-emerald-500",
  negative: "bg-rose-500",
  mixed: "bg-slate-400",
}
const TONE_GLYPH: Record<string, string> = { positive: "▲", negative: "▼", mixed: "◆" }

function polarityTone(p: string): "positive" | "negative" | "mixed" {
  return p === "positive" ? "positive" : p === "negative" ? "negative" : "mixed"
}

/** Rótulo de seção — caixa alta, discreto, com ícone opcional. */
function SectionLabel({
  icon: Icon,
  children,
  className,
}: {
  icon?: ComponentType<{ className?: string }>
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  )
}

/**
 * Régua de eixos: uma linha por eixo, ordenada do que mais agrada ao que mais incomoda.
 * A linha é COMPACTA de propósito — o texto do traço mora no painel ao lado, não aqui.
 * Medido: o traço tem 64 caracteres de média (p90 87, máx 157), então inline ele empurra
 * a régua e faz a altura do card mudar a cada clique.
 */
function AxisRuler({
  groups,
  selected,
  onSelect,
}: {
  groups: AxisGroup[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border" role="tablist" aria-label="Eixos citados nas reviews">
      {groups.map((g) => {
        const isOn = g.key === selected
        return (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={isOn}
            onClick={() => onSelect(g.key)}
            className={cn(
              "grid w-full grid-cols-[1fr_auto_auto] items-center gap-2.5 border-l-[3px] border-transparent px-3 py-2 text-left transition-colors",
              "not-first:border-t hover:bg-muted/60",
              isOn && "border-l-primary bg-muted/80",
            )}
          >
            <span className="truncate text-[12.5px] font-semibold">{g.label}</span>
            <span className={cn("flex items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold", TONE_TEXT[g.tone])}>
              <span aria-hidden>{TONE_GLYPH[g.tone].repeat(Math.min(3, Math.max(1, g.intensity)))}</span>
              {g.verdict}
            </span>
            <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-[10.5px] font-semibold tabular-nums text-muted-foreground">
              {g.traits.length}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Painel do eixo escolhido — o vão que sobrava à direita da régua virou o lugar de ler. */
function AxisDetail({ group }: { group: AxisGroup | null }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3.5" role="tabpanel" aria-live="polite">
      {group ? (
        <>
          <div className="flex items-baseline gap-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            {group.label}
            <span className="font-semibold opacity-80">
              {group.traits.length} {group.traits.length === 1 ? "traço citado" : "traços citados"}
            </span>
          </div>
          {group.traits.map((t, i) => (
            <span key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[polarityTone(t.polarity)])} aria-hidden />
              {t.trait}
            </span>
          ))}
        </>
      ) : (
        <span className="text-[13px] text-muted-foreground">Escolha um eixo para ler o que as reviews dizem dele.</span>
      )}
    </div>
  )
}

/**
 * Histograma das notas dadas nas próprias reviews. Bloco CONDICIONAL: só 17,9% das reviews
 * trazem nota e apenas 291 das 882 obras com review têm cinco ou mais (medido no clone local).
 */
function RatingsPanel({ bins, total }: { bins: RatingBin[]; total: number }) {
  const max = Math.max(...bins.map((b) => b.count), 1)
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3.5">
      <SectionLabel>{total} notas de leitor</SectionLabel>
      <div className="flex h-14 items-end gap-1.5" role="img" aria-label={describeRatings(bins, total)}>
        {bins.map((b) => (
          <span
            key={b.score}
            title={`${b.count} nota${b.count === 1 ? "" : "s"} em ${b.score}`}
            style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }}
            className={cn(
              "flex-1 rounded-t-[3px]",
              b.count === 0
                ? "bg-muted-foreground/15"
                : b.tone === "low"
                  ? "bg-rose-500/70"
                  : b.tone === "high"
                    ? "bg-emerald-500/70"
                    : "bg-muted-foreground/40",
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] tabular-nums text-muted-foreground">
        <span>{bins[0]?.score}</span>
        <span>{bins[bins.length - 1]?.score}</span>
      </div>
    </div>
  )
}

/** Quatro barrinhas crescentes — quantas acesas vem de `reviewSignal`. */
function SignalBars({ bars }: { bars: number }) {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {[5, 8, 11, 14].map((h, i) => (
        <span
          key={h}
          style={{ height: h }}
          className={cn("w-[3px] rounded-[1px]", i < bars ? "bg-emerald-500" : "bg-muted-foreground/30")}
        />
      ))}
    </span>
  )
}

function ratingColor(rating: number | null): string {
  if (rating == null) return "text-muted-foreground"
  if (rating >= 8) return "text-emerald-600 dark:text-emerald-300"
  if (rating >= 6) return "text-lime-600 dark:text-lime-300"
  if (rating >= 4) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

export function WorkReviewsCard({ snapshot, workId, provenance }: WorkReviewsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [proseOpen, setProseOpen] = useState(false)
  const [execOpen, setExecOpen] = useState(false)
  const [axisKey, setAxisKey] = useState<string | null>(null)
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const [generating, startGenerate] = useTransition()

  // Eixos e notas saem do snapshot; o hook fica ANTES de qualquer return condicional
  // (o early-return de "nenhuma review" está logo abaixo).
  const axisGroups = useMemo(
    () => groupTraitsByAxis(snapshot.digest?.salient_traits),
    [snapshot.digest?.salient_traits],
  )
  const ratings = useMemo(() => ratingHistogram(collectUserRatings(snapshot.bySource)), [snapshot.bySource])

  const runGenerate = async (force: boolean) => {
    if (!(await confirmCost({ action: "review_digest" }))) return
    startGenerate(async () => {
      const res = await generateWorkReviewDigest(workId, { force })
      if (!res.ok) {
        toast.error(res.message ?? "Falha ao destilar as reviews.")
        return
      }
      if (res.status === "generated") {
        toast.success(`Síntese gerada${res.costUsd ? ` (${formatUsdApprox(res.costUsd)})` : ""}.`)
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareText className="size-4 text-muted-foreground" />
                O que dizem as reviews
              </CardTitle>
              <span className="text-[11.5px] text-muted-foreground">Nenhuma review salva</span>
            </div>
            <RefetchReviewsButton workId={workId} variant="default" size="sm" />
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
  const totalReviews = snapshot.total + snapshot.manual.length
  // Fontes = união das raspadas com as das manuais. Contar só `bySource` sub-reporta:
  // uma review manual de uma fonte que nunca foi raspada não aparecia na contagem.
  const sourceCount = new Set<string>([
    ...snapshot.bySource.map((s) => s.source),
    ...snapshot.manual.map((r) => r.source),
  ]).size

  // Abre no eixo MAIS CITADO: o topo da régua costuma ter um traço só, e o painel nasceria
  // com uma frase e um vão embaixo.
  const selectedAxis = axisKey ?? defaultAxisKey(axisGroups)
  const activeGroup = axisGroups.find((g) => g.key === selectedAxis) ?? axisGroups[0] ?? null
  const signal = reviewSignal(totalReviews, sourceCount)

  return (
    <Card>
      {/* HEADER: título + força do sinal + ações de curadoria em peso mínimo (só ícone). */}
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="size-4 text-muted-foreground" />
              O que dizem as reviews
              {/* Um selo só, com as DUAS gerações dentro. Dois selos lado a lado no
                  mesmo cabeçalho seriam piores que a faixa de meta que estamos tirando —
                  e ninguém saberia qual é qual. As reviews cruas não levam selo: são
                  texto de leitor, não de modelo. */}
              {(digest != null || snapshot.summary) && (
                <AiProvenanceSeal
                  title="Síntese gerada por IA"
                  model={digest != null ? provenance?.digestModel : provenance?.summaryModel}
                  promptVersion={digest != null ? provenance?.digestPromptVersion : null}
                  at={digest != null ? snapshot.digestAt : snapshot.summaryAt}
                  extra={[
                    {
                      label: "Entraram",
                      value:
                        snapshot.digestN != null
                          ? `${snapshot.digestN} de ${totalReviews} reviews`
                          : null,
                    },
                    ...(digest != null && snapshot.summary
                      ? [
                          {
                            label: "Prosa",
                            value: [
                              provenance?.summaryModel,
                              formatProvenanceDate(snapshot.summaryAt),
                            ]
                              .filter(Boolean)
                              .join(" · ") || null,
                          },
                        ]
                      : []),
                  ]}
                  note="A síntese estruturada e o resumo em prosa são gerações separadas."
                />
              )}
            </CardTitle>
            {/* A força do sinal ganha peso: um consenso de 155 reviews e um de 1 eram
                desenhados igual. O critério e o `digestN` moram no popover — não somem
                num tooltip de hover, que em toque não existe. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex w-fit items-center gap-1.5 text-[11.5px] text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                >
                  <SignalBars bars={signal.bars} />
                  <span>
                    <span className="font-semibold text-foreground">Sinal {signal.strength}</span>
                    {" · "}
                    <span className="font-semibold tabular-nums text-foreground">{totalReviews}</span> review{totalReviews === 1 ? "" : "s"}
                    {sourceCount > 0 && (
                      <>
                        {" · "}
                        <span className="font-semibold tabular-nums text-foreground">{sourceCount}</span> fonte{sourceCount === 1 ? "" : "s"}
                      </>
                    )}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-2 text-[12.5px] leading-relaxed">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  De onde vem “sinal {signal.strength}”
                </p>
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground">{totalReviews}</span> review{totalReviews === 1 ? "" : "s"} de{" "}
                  <span className="font-semibold text-foreground">{sourceCount}</span> fonte{sourceCount === 1 ? "" : "s"}
                  {snapshot.digestN != null && (
                    <>
                      , e <span className="font-semibold text-foreground">{snapshot.digestN}</span> entraram na síntese
                    </>
                  )}
                  . A mediana do catálogo é 21 reviews, e um quarto das obras tem síntese feita com menos de 10 —
                  quanto mais fontes e mais reviews, menos o consenso depende de quem escreveu.
                </p>
                {snapshot.manual.length > 0 && (
                  <p className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{snapshot.manual.length}</span>{" "}
                    {snapshot.manual.length === 1 ? "review foi adicionada" : "reviews foram adicionadas"} à mão.
                  </p>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {/* Ações de CURADORIA em peso mínimo: o card existe para o leitor decidir, e até
              2026-08-09 o botão azul "Buscar reviews" era o elemento mais chamativo dele. */}
          <div className="flex items-center gap-1">
            <RefetchReviewsButton workId={workId} variant="ghost" size="sm" iconOnly />
            {digest != null && (
              <Button
                size="sm"
                variant="ghost"
                className="size-8 p-0"
                disabled={generating}
                onClick={() => void runGenerate(true)}
                aria-label="Regerar síntese"
                title={
                  snapshot.digestN != null
                    ? `Refaz a síntese estruturada a partir das reviews atuais (${snapshot.digestN} entraram na última; custo Sonnet ~$0,02–0,05). Não regera o resumo em prosa.`
                    : "Refaz a síntese estruturada a partir das reviews atuais (custo Sonnet ~$0,02–0,05). Não regera o resumo em prosa."
                }
              >
                {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="@container flex flex-col gap-4 pt-0">
        {digestLeads && digest ? (
          <>
            {/* CIMA: os textos à esquerda; as notas e os avisos à direita, na coluna que
                antes era o vão do card. */}
            <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_292px]">
              <div className="flex min-w-0 flex-col gap-3">
                <div>
                  <SectionLabel icon={Users}>O que quase todos dizem</SectionLabel>
                  <p className="mt-1.5 text-[15px] leading-relaxed">{digest.consensus}</p>
                </div>
                {digest.divergence?.trim() && (
                  <div className="rounded-xl bg-muted/50 p-3.5">
                    <SectionLabel icon={ArrowLeftRight}>Onde as opiniões racham</SectionLabel>
                    <ExpandableText
                      text={digest.divergence}
                      maxLines={4}
                      className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground"
                    />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-3">
                {ratings.bins.length > 0 && <RatingsPanel bins={ratings.bins} total={ratings.total} />}

                {/* Aviso de conteúdo — único amber do painel. As pílulas ficam à vista; o
                    texto inteiro abre no popover, porque é o que muda decisão e não cabe
                    numa linha (mediana de 3 avisos, 85% das obras têm). */}
                {digest.content_warnings?.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {digest.content_warnings.length} aviso{digest.content_warnings.length === 1 ? "" : "s"} de conteúdo
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="ml-auto text-[11.5px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                          >
                            ver
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 space-y-2">
                          <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                            Avisos de conteúdo
                          </p>
                          <ul className="flex flex-col gap-2">
                            {digest.content_warnings.map((w, i) => (
                              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                                {w}
                              </li>
                            ))}
                          </ul>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      {digest.content_warnings.map((w, i) => (
                        <span
                          key={i}
                          title={w}
                          className="max-w-full truncate rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-amber-500/30"
                        >
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* BAIXO: régua de eixos à esquerda, o que as reviews dizem do eixo à direita.
                O texto entra num espaço JÁ reservado — por isso a altura do card não muda
                ao trocar de eixo. */}
            {axisGroups.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <SectionLabel>Onde ela acerta e onde falha</SectionLabel>
                  <span className="text-[11.5px] text-muted-foreground">
                    do que mais agrada ao que mais incomoda · {digest.salient_traits.length} traço
                    {digest.salient_traits.length === 1 ? "" : "s"} em {axisGroups.length} eixo
                    {axisGroups.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid items-stretch gap-3.5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                  <AxisRuler groups={axisGroups} selected={activeGroup?.key ?? null} onSelect={setAxisKey} />
                  <AxisDetail group={activeGroup} />
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Clique num eixo para ler o que as reviews dizem dele. O número é quantos traços daquele eixo elas citaram.
                </p>
              </div>
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
                  ser exibida. Use <span className="font-medium text-foreground">Regerar síntese</span> para refazê-la.
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

      {/* RODAPÉ: as gavetas DIVIDEM uma faixa em vez de empilhar linhas quase vazias.
          "Sobre a execução" desceu para cá — em prosa ela repetia arte e ritmo, que a régua
          de eixos já cobre (medido: 294 caracteres de mediana). */}
      <div className="@container border-t">
        <div className="grid @2xl:grid-cols-[auto_auto_minmax(0,1fr)]">
          {digestLeads && digest?.execution?.trim() && (
            <button
              type="button"
              onClick={() => setExecOpen((v) => !v)}
              aria-expanded={execOpen}
              className="flex w-full items-center gap-2.5 px-6 py-3 text-left text-[13px] text-muted-foreground transition-colors not-first:border-t hover:bg-muted/30 hover:text-foreground @2xl:not-first:border-t-0 @2xl:not-first:border-l"
            >
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", execOpen && "rotate-180")} />
              <span className="font-medium text-foreground">Sobre a execução</span>
            </button>
          )}

          {digestLeads && snapshot.summary && (
            <button
              type="button"
              onClick={() => setProseOpen((v) => !v)}
              aria-expanded={proseOpen}
              className="flex w-full items-center gap-2.5 px-6 py-3 text-left text-[13px] text-muted-foreground transition-colors not-first:border-t hover:bg-muted/30 hover:text-foreground @2xl:not-first:border-t-0 @2xl:not-first:border-l"
            >
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", proseOpen && "rotate-180")} />
              {/* A data do resumo saiu daqui: ela é proveniência e mora no selo ✨ do
                  cabeçalho, junto do modelo que a gerou. */}
              <span className="font-medium text-foreground">Resumo em prosa</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={cn(
              "flex w-full items-center gap-2.5 px-6 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground",
              "not-first:border-t @2xl:not-first:border-t-0 @2xl:not-first:border-l",
            )}
          >
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          <span className="font-medium text-foreground">
            {expanded ? "Ocultar as reviews" : `Ver as ${totalReviews} review${totalReviews === 1 ? "" : "s"}`}
          </span>
          {snapshot.manual.length > 0 && (
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <PenLine className="h-3 w-3" />
              {snapshot.manual.length} {snapshot.manual.length === 1 ? "manual" : "manuais"}
            </Badge>
          )}
            {snapshot.fetchedAt && (
              <span className="ml-auto text-[11px] text-muted-foreground/70">
                buscadas {formatRelativeDateTime(snapshot.fetchedAt)}
              </span>
            )}
          </button>
        </div>

        {execOpen && digest?.execution?.trim() && (
          <p className="mx-6 mb-3 rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
            {digest.execution}
          </p>
        )}
        {proseOpen && snapshot.summary && (
          <p className="mx-6 mb-3 whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
            {snapshot.summary}
          </p>
        )}
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
