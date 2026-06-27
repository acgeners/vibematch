import Link from "next/link"
import { AlertTriangle, BookOpen, ExternalLink, ImageOff, MessageSquarePlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { titleToSlug } from "@/lib/utils"
import { SemReviewsFilters } from "@/components/ai-evaluation/sem-reviews-filters"
import { ReviewRowAction, ReviewBatchAction } from "@/components/ai-evaluation/review-actions"
import type { NoReviewSort, NoReviewWork } from "@/lib/reviews/no-review-classify"

function bandLabel(min: number, max: number, unit: string): string {
  if (min > 0 && max >= min) return `entre ${min} e ${max} ${unit}`
  if (min > 0) return `≥ ${min} ${unit}`
  if (max > 0) return `até ${max} ${unit}`
  return `sem ${unit}`
}

/**
 * Aba "Sem reviews" — diagnóstico read-only: obras ativas sem nenhuma review útil.
 * Tela de AÇÃO MANUAL: NÃO gera reviews/summary/digest/avaliação/previsão.
 */
export function SemReviewsTab({
  works,
  totalWithoutReviews,
  q,
  activePubStatuses,
  activePersonalStatuses,
  activeInterest,
  hasExternal,
  goldenOnly,
  minReviews,
  maxReviews,
  sort,
}: {
  works: NoReviewWork[]
  totalWithoutReviews: number
  q: string
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  activeInterest: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
  minReviews: number
  maxReviews: number
  sort: NoReviewSort
}) {
  const universeLabel = bandLabel(minReviews, maxReviews, "review(s) útil(eis)")
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-muted-foreground">
          Obras sem reviews são avaliadas/previstas com <strong>menos contexto</strong> (pior qualidade). Use{" "}
          <strong>Buscar reviews + digest</strong> (individual ou em fila) pra colher reviews das fontes aceitas e
          gerar o digest — <strong>consome tokens</strong> (digest Sonnet). Sem fontes externas aceitas, a busca é
          no-op; nesse caso adicione reviews manualmente.
        </p>
      </div>

      <SemReviewsFilters
        q={q}
        activePubStatuses={activePubStatuses}
        activePersonalStatuses={activePersonalStatuses}
        activeInterest={activeInterest}
        hasExternal={hasExternal}
        goldenOnly={goldenOnly}
        minReviews={minReviews}
        maxReviews={maxReviews}
        sort={sort}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {works.length} de {totalWithoutReviews} obra(s) {universeLabel} (universo total ativo sem filtro de busca).
        </p>
        {works.length > 0 ? <ReviewBatchAction workIds={works.map((w) => w.id)} /> : null}
      </div>

      {works.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhuma obra deste filtro está dentro do limite de reviews úteis.
        </p>
      ) : (
        <ul className="space-y-2">
          {works.map((w) => {
            const slug = titleToSlug(w.title)
            return (
              <li key={w.id} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
                  {w.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-4 w-4" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/titles/${slug}`} className="font-medium hover:underline">
                      {w.title}
                    </Link>
                    {w.inGolden ? <Badge variant="secondary">Golden pilot-1</Badge> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline">{w.publicationStatus}</Badge>
                    <Badge variant="outline">{w.personalStatus}</Badge>
                    <Badge variant="outline">{w.usefulReviewCount} review(s) útil(eis)</Badge>
                    {w.expectedScore != null ? (
                      <Badge variant="outline">Nota prevista {w.expectedScore.toFixed(1)}</Badge>
                    ) : null}
                    {w.interest ? <Badge variant="outline">Interesse {w.interest}</Badge> : null}
                    <Badge variant="outline">{w.aiEvalStatus ?? "—"}</Badge>
                    {!w.canonicalPresent ? <Badge variant="destructive">sem sinopse canônica</Badge> : null}
                    {w.acceptedExternalSources.length > 0 ? (
                      <Badge variant="outline">Possui fontes: {w.acceptedExternalSources.join(", ")}</Badge>
                    ) : (
                      <Badge variant="outline">Sem fontes externas aceitas</Badge>
                    )}
                    {w.lastFetchedAt ? (
                      <Badge variant="outline">reviews coletadas em {w.lastFetchedAt.slice(0, 10)}</Badge>
                    ) : (
                      <Badge variant="outline">sem reviews coletadas</Badge>
                    )}
                  </div>

                  {w.inGolden ? (
                    <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-muted-foreground">
                      O snapshot experimental <strong>base-1</strong> já foi congelado sem reviews. Adicionar reviews
                      agora não altera esse snapshot — usar os novos dados no experimento exigirá uma nova versão.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs">
                    <Link href={`/titles/${slug}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <BookOpen className="h-3.5 w-3.5" /> Abrir obra
                    </Link>
                    <Link href={`/titles/${slug}/edit`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <MessageSquarePlus className="h-3.5 w-3.5" /> Adicionar review manualmente
                    </Link>
                    {w.acceptedExternalSources.length > 0 ? (
                      <Link href={`/titles/${slug}/edit`} className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" /> Revalidar fontes (pode acessar fontes externas)
                      </Link>
                    ) : null}
                  </div>

                  <div className="pt-0.5">
                    <ReviewRowAction workId={w.id} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
