"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { BookOpen, ChevronDown, ChevronUp, MessageSquare, Star, StickyNote, Tag, Users } from "lucide-react"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { CoverImage } from "@/components/ui/cover-image"
import { AdultBadge } from "@/components/ui/adult-badge"
import { ScoreBadge } from "@/components/ui/score-badge"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
import { cn } from "@/lib/utils"
import { getWorkHoverCounts, type WorkPreview } from "@/server/actions/works"

interface WorkHoverPreviewProps {
  preview: WorkPreview
  anchorRect: DOMRect
  /** Ponte de hover: manter a prévia aberta quando o mouse entra nela (prévia interativa). */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /**
   * "compact" (view de Cards do /ranking): o card já mostra capa/título/18+/notas, então a
   * prévia foca no que NÃO está lá — sinopse (destaque) + ano + tags/reviews/nota. "full"
   * (default, demais telas) mantém a prévia completa.
   */
  variant?: "full" | "compact"
}

interface WorkCounts {
  tagCount: number
  reviewCount: number
}

// Contagens são as mesmas em qualquer surface, então cacheamos por obra pra não
// refazer a RPC a cada re-hover.
const countsCache = new Map<string, WorkCounts>()

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

/** Escala de 4 corações (preenchidos = valor, resto esmaecido) — mesma da lista do ranking. */
function Hearts({ quality, variant }: { quality: string; variant: "manual" | "pred" }) {
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = 4 - filled
  return (
    <span
      className={cn(
        "text-[15px] leading-none tracking-[0.12em]",
        variant === "manual" ? "text-red-500" : "text-orange-500",
      )}
    >
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}

/** Interesse: manual (rosa) + previsto (salmão + selo IA), mesma paleta do filtro. */
function InterestHearts({
  manual,
  manualFromPrediction = false,
  predicted,
  predictedStale,
}: {
  manual: string | null
  /** Manual foi aplicado da previsão (não definido à mão) → selo ✨. */
  manualFromPrediction?: boolean
  predicted: string | null
  predictedStale: boolean
}) {
  if (!manual && !predicted) return null
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" aria-label="Interesse na obra">
      {manual && <Hearts quality={manual} variant="manual" />}
      {manual && manualFromPrediction && <InterestAppliedMark size={12} />}
      {manual && predicted && <span className="h-3 w-px bg-border/70" aria-hidden />}
      {predicted && (
        <span className="inline-flex items-center gap-1">
          <Hearts quality={predicted} variant="pred" />
          <span
            className={cn(
              "rounded border border-orange-500/40 px-[3px] text-[8px] font-extrabold leading-[1.4] tracking-wide text-orange-500 dark:text-orange-400",
              predictedStale && "opacity-60",
            )}
          >
            IA
          </span>
        </span>
      )}
    </span>
  )
}

/** Status curto e discreto: emoji + código, sem pill/borda, na cor do status (hex do DB). */
function StatusFacet({ statusId }: { statusId: number }) {
  const info = PUBLICATION_STATUSES_BY_ID[statusId]
  if (!info) return null
  return (
    <span className="inline-flex items-center gap-1" title={info.status}>
      <span aria-hidden>{info.symbol}</span>
      <span className="font-medium" style={info.color ? { color: info.color } : undefined}>
        {info.short}
      </span>
    </span>
  )
}

/** Bloco da tira de notas: rótulo minúsculo + ícone/valor — igual aos cards do ranking. */
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="inline-flex items-center gap-1 text-[13px] font-bold leading-none tabular-nums">
        {children}
      </span>
    </div>
  )
}

export function WorkHoverPreview({ preview, anchorRect, onMouseEnter, onMouseLeave, variant = "full" }: WorkHoverPreviewProps) {
  const compact = variant === "compact"
  const margin = 2
  const screenMargin = 8
  const popupWidth = compact ? 340 : 420
  // Altura da prévia COLAPSADA, usada pra decidir o `top` perto do rodapé da janela — e, por
  // tabela, o `maxHeight` de baixo. Medida no browser em 2026-08-18 com título de 2 linhas
  // (o pior caso, `line-clamp-2`): a "full" fecha em 381px. Subestimar não estoura nada, mas
  // faz a prévia colapsada ROLAR por dentro nas linhas do fim da lista — era o que o 250 fixo
  // já fazia com os 293px de antes. 390 dá a folga.
  const popupHeight = compact ? 250 : 390
  const willOverflowRight = anchorRect.right + margin + popupWidth > window.innerWidth
  const left = willOverflowRight
    ? Math.max(screenMargin, anchorRect.left - popupWidth - margin)
    : anchorRect.right + margin
  const top = Math.min(
    Math.max(screenMargin, anchorRect.top),
    window.innerHeight - popupHeight - screenMargin
  )
  // Teto de altura ancorado no `top`: a prévia expandida ("Ler mais") cresce até aqui e então
  // rola por dentro, sem estourar a viewport. Colapsada cabe folgado, sem scroll.
  const maxHeight = window.innerHeight - top - screenMargin

  // "Ler mais": mede o overflow da sinopse com o clamp ligado; o botão só aparece se transbordar.
  const [expanded, setExpanded] = useState(false)
  const synopsisRef = useRef<HTMLParagraphElement | null>(null)
  const [synopsisOverflow, setSynopsisOverflow] = useState(false)
  useLayoutEffect(() => {
    if (expanded) return
    const el = synopsisRef.current
    setSynopsisOverflow(el ? el.scrollHeight > el.clientHeight + 1 : false)
  }, [preview.synopsis, expanded])

  // Tags + reviews sob demanda no hover (1 chamada por obra, cacheada).
  const [counts, setCounts] = useState<WorkCounts | null>(
    () => countsCache.get(preview.workId) ?? null
  )
  useEffect(() => {
    if (counts) return
    let alive = true
    getWorkHoverCounts(preview.workId)
      .then((c) => {
        countsCache.set(preview.workId, c)
        if (alive) setCounts(c)
      })
      .catch(() => {
        // silencioso — o rodapé só fica com "—"
      })
    return () => {
      alive = false
    }
  }, [preview.workId, counts])

  const hasMeta1 = preview.year != null || preview.totalChapters != null || preview.publicationStatusId != null
  const hasInterest = Boolean(preview.synopsisQuality || preview.predictedSynopsisQuality)
  const hasComment = Boolean(preview.observations && preview.observations.trim())

  // ── Variante enxuta (view de Cards do /ranking) ──────────────────────────────────────
  // Só o que o card NÃO mostra: sinopse em destaque (largura toda, sem capa) + ano no
  // cabeçalho + rodapé com tags/reviews/nota. Sem 18+, corações, N.Prevista, Externa, Votos —
  // tudo isso já está no card ao lado.
  if (compact) {
    const hasFooter =
      hasComment || (counts != null && (counts.tagCount > 0 || counts.reviewCount > 0))
    return (
      <div
        className="fixed z-50 w-[340px] overflow-y-auto overflow-x-hidden rounded-xl border border-black/10 bg-[#f4f6fb] text-popover-foreground shadow-2xl dark:border-white/12 dark:bg-[#1c2230]"
        style={{ left, top, maxHeight }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Cabeçalho discreto: título (âncora quando há vários cards) + ano */}
        <div className="flex items-start justify-between gap-2.5 border-b border-border/60 px-4 pb-2.5 pt-3.5">
          <p className="min-w-0 break-words font-semibold text-[14.5px] leading-tight line-clamp-2">{preview.title}</p>
          {preview.year != null && (
            <span className="shrink-0 pt-px text-xs font-semibold tabular-nums text-muted-foreground">
              {preview.year}
            </span>
          )}
        </div>

        {/* Sinopse — o herói. Sem capa, ocupa a largura toda (até 8 linhas, depois "Ler mais"). */}
        {preview.synopsis ? (
          <div className="px-4 py-3">
            <p
              ref={synopsisRef}
              className={cn(
                "text-[13px] italic text-muted-foreground break-words whitespace-normal leading-relaxed",
                !expanded && "line-clamp-[8]",
              )}
            >
              {preview.synopsis}
            </p>
            {(synopsisOverflow || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold not-italic text-primary hover:underline"
              >
                {expanded ? "Ler menos" : "Ler mais"}
                {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 py-3 text-[13px] italic text-muted-foreground/70">Sem sinopse.</div>
        )}

        {/* Rodapé: só tags · reviews · nota (o resto está no card). */}
        {hasFooter && (
          <div className="flex items-center gap-3.5 border-t border-border/60 bg-black/[0.015] px-4 py-2 text-xs text-muted-foreground dark:bg-white/[0.025]">
            {counts != null && counts.tagCount > 0 && (
              <span title="Tags da obra" className="inline-flex items-center gap-1 tabular-nums">
                <Tag className="size-3.5" />
                {counts.tagCount}
              </span>
            )}
            {counts != null && counts.reviewCount > 0 && (
              <span title="Reviews úteis (≥40 caracteres)" className="inline-flex items-center gap-1 tabular-nums">
                <MessageSquare className="size-3.5" />
                {counts.reviewCount}
              </span>
            )}
            {hasComment && (
              <span title="Você comentou nesta obra" className="inline-flex items-center">
                <StickyNote className="size-3.5" />
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="fixed z-50 w-[420px] overflow-y-auto overflow-x-hidden rounded-xl border border-black/10 bg-[#f4f6fb] text-popover-foreground shadow-2xl dark:border-white/12 dark:bg-[#1c2230]"
      style={{ left, top, maxHeight }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="p-4">
        {/* Cabeçalho: capa + IDENTIFICAÇÃO (título, 18+, ano/capítulos/status, interesse).
            🔴 A sinopse NÃO mora aqui — ela desce pra faixa de baixo, na largura toda.
            Medido no browser em 2026-08-18 (popup de 420px): ao lado da capa ela tinha
            242px e a mesma sinopse ocupava 27 linhas expandida (686px de prévia); embaixo
            tem 386px (+59%) e cai pra 17 linhas (609px). O que a coluna estreita produzia
            era texto espremido com um vão de ~90px vazio embaixo da capa — o espaço existia,
            só estava do lado errado.
            `items-center`: a identificação tem ~86px (título de 2 linhas + as duas faixas) e
            a capa tem 160px, então sobra ar por construção. Centrado ele vira respiro dos
            dois lados em vez de um buraco embaixo do último chip. */}
        <div className="flex items-center gap-3.5">
          {preview.coverUrls.length > 0 ? (
            <div className="relative h-40 w-28 shrink-0 rounded-md overflow-hidden bg-muted">
              <CoverImage urls={preview.coverUrls} className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="h-40 w-28 shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
              Sem capa
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {/* Título + chip 18+ (mesmo tratamento do cabeçalho da obra) */}
            <div className="flex items-start gap-1.5">
              <p className="font-semibold text-[15px] leading-tight line-clamp-2 min-w-0 flex-1 break-words">{preview.title}</p>
              {preview.isAdult && (
                <AdultBadge className="mt-px shrink-0 px-1.5 py-0 text-[10px] leading-tight" />
              )}
            </div>

            {/* Linha 1: ano · capítulos · status curto (discreto) */}
            {hasMeta1 && (
              <div className="flex items-center gap-1.5 flex-wrap text-xs font-medium text-foreground/75">
                {preview.year != null && <span className="opacity-90">{preview.year}</span>}
                {preview.year != null && preview.totalChapters != null && (
                  <span className="text-foreground/40">·</span>
                )}
                {preview.totalChapters != null && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <BookOpen className="size-3 text-muted-foreground/70" />
                    {preview.totalChapters}
                  </span>
                )}
                {(preview.year != null || preview.totalChapters != null) &&
                  preview.publicationStatusId != null && <span className="text-foreground/40">·</span>}
                {preview.publicationStatusId != null && (
                  <StatusFacet statusId={preview.publicationStatusId} />
                )}
              </div>
            )}
            {/* Linha 2: interesses (manual + previsto) */}
            {hasInterest && (
              <InterestHearts
                manual={preview.synopsisQuality}
                manualFromPrediction={preview.synopsisFromPrediction}
                predicted={preview.predictedSynopsisQuality}
                predictedStale={preview.predictedSynopsisStale}
              />
            )}
          </div>
        </div>

        {/* Sinopse: largura toda, abaixo da capa. O divisor é o border-t (antes ele ficava só
            sob a coluna da direita, cortando a prévia pela metade). */}
        {preview.synopsis && (
          <div className="mt-3 border-t border-border/60 pt-2.5">
            <p
              ref={synopsisRef}
              className={cn(
                "text-[13px] italic text-muted-foreground break-words whitespace-normal leading-snug",
                !expanded && "line-clamp-5",
              )}
            >
              {preview.synopsis}
            </p>
            {(synopsisOverflow || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold not-italic text-primary hover:underline"
              >
                {expanded ? "Ler menos" : "Ler mais"}
                {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Rodapé: tags + reviews à esquerda · externa + votos à direita */}
      <div className="border-t border-border/60 bg-black/[0.015] px-4 py-2 flex items-center justify-between gap-3 dark:bg-white/[0.025]">
        {/* Cada indicador só aparece quando o item existe (tags>0, reviews>0, comentário).
            Enquanto as contagens carregam (counts === null), tags/reviews ficam ocultos. */}
        <div className="inline-flex items-center gap-3.5 text-xs text-muted-foreground">
          {counts != null && counts.tagCount > 0 && (
            <span title="Tags da obra" className="inline-flex items-center gap-1 tabular-nums">
              <Tag className="size-3.5" />
              {counts.tagCount}
            </span>
          )}
          {counts != null && counts.reviewCount > 0 && (
            <span title="Reviews úteis (≥40 caracteres)" className="inline-flex items-center gap-1 tabular-nums">
              <MessageSquare className="size-3.5" />
              {counts.reviewCount}
            </span>
          )}
          {hasComment && (
            <span title="Você comentou nesta obra" className="inline-flex items-center">
              <StickyNote className="size-3.5" />
            </span>
          )}
        </div>
        <div className="inline-flex items-stretch gap-3">
          {/* Nota Prevista + Sua nota (Real) — mesmo pareamento "Prevista / Real" do
              cabeçalho da obra. Só a Prevista quando você ainda não avaliou. */}
          {(preview.expectedScore != null || preview.userScore != null) && (
            <>
              <Metric
                label={
                  preview.expectedScore != null && preview.userScore != null
                    ? "Prevista / Real"
                    : preview.userScore != null
                      ? "Real"
                      : LABELS.expected_score.short
                }
              >
                {preview.expectedScore != null && (
                  <ScoreBadge score={preview.expectedScore} size="sm" showStub={preview.expectedIsStub} />
                )}
                {preview.expectedScore != null && preview.userScore != null && (
                  <span className="font-mono text-muted-foreground/50">/</span>
                )}
                {preview.userScore != null && <ScoreBadge score={preview.userScore} size="sm" />}
              </Metric>
              <span className="w-px self-stretch bg-border/60" aria-hidden />
            </>
          )}
          <Metric label="Externa">
            {preview.platformAvg != null ? (
              <>
                <Star className="size-3 fill-amber-500 text-amber-500" />
                {preview.platformAvg.toFixed(1).replace(".", ",")}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Metric>
          <Metric label="Votos">
            {preview.totalVotes > 0 ? (
              <>
                <Users className="size-3 text-muted-foreground/70" />
                {formatVotes(preview.totalVotes)}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Metric>
        </div>
      </div>
    </div>
  )
}
