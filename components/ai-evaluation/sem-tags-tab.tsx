import Link from "next/link"
import { AlertTriangle, BookOpen, ExternalLink, ImageOff, Tags } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { titleToSlug } from "@/lib/utils"
import { SemTagsFilters } from "@/components/ai-evaluation/sem-tags-filters"
import type { NoTagsWork } from "@/lib/tags/no-tags-classify"

/**
 * Aba "Sem tags" — diagnóstico read-only: obras ativas com poucas (ou nenhuma) tags.
 * Tela de AÇÃO MANUAL: NÃO gera tags/avaliação/previsão. Espelha a aba "Sem reviews".
 */
export function SemTagsTab({
  works,
  totalWithoutTags,
  q,
  activePubStatuses,
  hasExternal,
  goldenOnly,
  maxTags,
}: {
  works: NoTagsWork[]
  totalWithoutTags: number
  q: string
  activePubStatuses: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
  maxTags: number
}) {
  const universeLabel = maxTags > 0 ? `até ${maxTags} tag(s)` : "sem tags"
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-muted-foreground">
          Obras com poucas tags têm <strong>menos sinal</strong> para recomendação e previsão (overlap de tags
          amadas/evitadas, fit por critério). Adicione tags manualmente ou importe de uma fonte externa. Esta tela é
          apenas diagnóstico — <strong>não</strong> gera tags, avaliação nem previsão.
        </p>
      </div>

      <SemTagsFilters q={q} activePubStatuses={activePubStatuses} hasExternal={hasExternal} goldenOnly={goldenOnly} maxTags={maxTags} />

      <p className="text-xs text-muted-foreground">
        {works.length} de {totalWithoutTags} obra(s) {universeLabel} (universo total ativo sem filtro de busca).
      </p>

      {works.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhuma obra deste filtro está dentro do limite de tags.
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
                    <Badge variant={w.tagCount === 0 ? "destructive" : "outline"}>{w.tagCount} tag(s)</Badge>
                    <Badge variant="outline">{w.aiEvalStatus ?? "—"}</Badge>
                    {!w.canonicalPresent ? <Badge variant="destructive">sem sinopse canônica</Badge> : null}
                    {w.acceptedExternalSources.length > 0 ? (
                      <Badge variant="outline">Possui fontes: {w.acceptedExternalSources.join(", ")}</Badge>
                    ) : (
                      <Badge variant="outline">Sem fontes externas aceitas</Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs">
                    <Link href={`/titles/${slug}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <BookOpen className="h-3.5 w-3.5" /> Abrir obra
                    </Link>
                    <Link href={`/titles/${slug}/edit`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Tags className="h-3.5 w-3.5" /> Adicionar tags
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
