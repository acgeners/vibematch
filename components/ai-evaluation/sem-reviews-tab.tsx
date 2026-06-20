import Link from "next/link"
import { AlertTriangle, BookOpen, ExternalLink, ImageOff, MessageSquarePlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { titleToSlug } from "@/lib/utils"
import { SemReviewsFilters } from "@/components/ai-evaluation/sem-reviews-filters"
import type { NoReviewWork } from "@/lib/reviews/no-review-classify"

/**
 * Aba "Sem reviews" — diagnóstico read-only: obras ativas sem nenhuma review útil.
 * Tela de AÇÃO MANUAL: NÃO gera reviews/summary/digest/avaliação/previsão.
 */
export function SemReviewsTab({
  works,
  totalWithoutReviews,
  q,
  activePubStatuses,
  hasExternal,
  goldenOnly,
}: {
  works: NoReviewWork[]
  totalWithoutReviews: number
  q: string
  activePubStatuses: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-muted-foreground">
          Obras sem reviews podem ser avaliadas ou previstas com <strong>menos contexto</strong>. Isso pode manter
          o custo semelhante, mas reduzir a qualidade do resultado. Adicione reviews manualmente quando houver uma
          fonte confiável. Esta tela é apenas diagnóstico — <strong>não</strong> gera reviews, avaliação nem previsão.
        </p>
      </div>

      <SemReviewsFilters q={q} activePubStatuses={activePubStatuses} hasExternal={hasExternal} goldenOnly={goldenOnly} />

      <p className="text-xs text-muted-foreground">
        {works.length} de {totalWithoutReviews} obra(s) sem review útil (universo total ativo sem filtro de busca).
      </p>

      {works.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Todas as obras deste filtro possuem ao menos uma review útil.
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
                    <Badge variant="outline">0 reviews úteis</Badge>
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
