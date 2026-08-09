"use client"

import { useEffect, useState } from "react"
import { Info, Tag, FileText, MessageSquare, AlertTriangle, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import type { TagStanceInfo } from "@/lib/tags/segment"
import { TagStanceMark, tagStanceTitle } from "@/components/ui/tag-stance-mark"
import { getEffectiveTagStanceAction, getSynopsisInputsAction } from "@/server/actions/recommendations"

/** Inputs do preditor de Interesse — carregados sob demanda ao abrir o popover. */
type SynopsisInputsData = {
  canonicalSynopsis: string | null
  tags: string[]
  reviewDigest: ReviewDigest | null
}

function polarityClass(polarity: "positive" | "negative" | "mixed"): string {
  if (polarity === "positive") return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
  if (polarity === "negative") return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
  return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
}

type TasteTags = { loved: Set<string>; avoided: Set<string>; strong: Set<string>; declared: Set<string> }
const EMPTY_TASTE: TasteTags = { loved: new Set(), avoided: new Set(), strong: new Set(), declared: new Set() }

/**
 * Carrega as tags amadas/evitadas do perfil UMA vez por página (promise cacheada
 * no módulo). Cada card monta o próprio popover; sem esse cache, abrir a fila do
 * Interesse (~32 cards) dispararia ~32 chamadas idênticas ao perfil. A busca é
 * disparada só quando um popover ABRE (lazy) — cards fechados custam zero.
 */
/**
 * Carrega os nomes de tags amadas/evitadas EFETIVOS (perfil de gosto ∪ preferências
 * declaradas pelo usuário) 1× por página via promise cacheada no módulo (sem N+1).
 * O server já une as duas fontes, dá precedência às declaradas e normaliza os nomes.
 */
let tasteTagsPromise: Promise<TasteTags> | null = null
function loadTasteTags(): Promise<TasteTags> {
  if (!tasteTagsPromise) {
    tasteTagsPromise = getEffectiveTagStanceAction()
      .then(({ loved, avoided, strong, declared }) => ({
        loved: new Set(loved),
        avoided: new Set(avoided),
        strong: new Set(strong),
        declared: new Set(declared),
      }))
      .catch((e) => {
        console.error(e)
        tasteTagsPromise = null // permite retry
        return EMPTY_TASTE
      })
  }
  return tasteTagsPromise
}

/**
 * Popover que mostra os INPUTS usados pra prever o Interesse na sinopse: tags
 * agrupadas, sinopse canônica e digest de reviews (consenso/traços/alertas) —
 * exatamente o que o preditor recebe. Trigger discreto "inputs da previsão".
 *
 * Os inputs são carregados SOB DEMANDA (`getSynopsisInputsAction`) ao abrir o
 * popover — tirando o batch de hidratação do caminho crítico do SSR da fila.
 */
export function SynopsisInputsPopover({ workId }: { workId: string }) {
  // Inputs (sinopse/tags/digest) carregados lazy na 1ª abertura do popover.
  const [inputs, setInputs] = useState<SynopsisInputsData | null>(null)
  const [loading, setLoading] = useState(false)
  const onOpenChange = (open: boolean) => {
    if (open && inputs == null && !loading) {
      setLoading(true)
      getSynopsisInputsAction(workId)
        .then(setInputs)
        .catch((e) => console.error(e))
        .finally(() => setLoading(false))
    }
  }
  const canonicalSynopsis = inputs?.canonicalSynopsis ?? null
  const tags = inputs?.tags ?? []
  const reviewDigest = inputs?.reviewDigest ?? null
  const hasAny = !!(canonicalSynopsis || tags.length || reviewDigest)

  // Carrega o perfil (tags amadas/evitadas) no mount, via `loadTasteTags` (promise
  // cacheada no módulo → 1 fetch por página, sem N+1). Assim as cores já estão
  // prontas ANTES de abrir o popover — sem flash de "tags sem cor" na 1ª abertura.
  const [taste, setTaste] = useState<TasteTags | null>(null)
  useEffect(() => {
    let active = true
    void loadTasteTags().then((t) => {
      if (active) setTaste(t)
    })
    return () => {
      active = false
    }
  }, [])
  const lovedTagsSet = taste?.loved ?? EMPTY_TASTE.loved
  const avoidedTagsSet = taste?.avoided ?? EMPTY_TASTE.avoided
  const strongTagsSet = taste?.strong ?? EMPTY_TASTE.strong
  const declaredTagsSet = taste?.declared ?? EMPTY_TASTE.declared

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-4 w-4" /> Informações sobre a obra
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[36rem] w-[550px] max-w-[95vw] overflow-y-auto text-xs p-4 shadow-xl border border-border/80 bg-popover">
        {loading && inputs == null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando inputs…
          </p>
        ) : !hasAny ? (
          <p className="text-muted-foreground">Sem inputs hidratados para esta obra.</p>
        ) : (
          <div className="space-y-5">
            {tags && tags.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 border-b border-border/30 pb-1.5">
                  <Tag className="h-3.5 w-3.5 text-primary/80" />
                  <h3 className="text-xs font-semibold text-foreground">
                    Tags da Obra <span className="ml-1 text-[10px] font-normal text-muted-foreground">({tags.length})</span>
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => {
                    const lowerTag = t.toLowerCase()
                    const isLoved = lovedTagsSet.has(lowerTag)
                    const isAvoided = avoidedTagsSet.has(lowerTag)
                    // Ênfase 2× e origem (declarada × perfil) — o tooltip precisa
                    // das duas: sem a origem ele afirmaria "você marcou" pra tag
                    // que o modelo inferiu sozinho.
                    const stance: TagStanceInfo | null =
                      isLoved || isAvoided
                        ? {
                            stance: isLoved ? "love" : "avoid",
                            strong: strongTagsSet.has(lowerTag),
                            source: declaredTagsSet.has(lowerTag) ? "declared" : "profile",
                          }
                        : null

                    return (
                      <Badge
                        key={t}
                        variant="outline"
                        className={cn(
                          "gap-1 px-2 py-0.5 text-[11px] font-normal rounded-md border transition-colors",
                          isLoved
                            ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40"
                            : isAvoided
                              ? "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40"
                              : "bg-muted/30 border-border/80 text-muted-foreground",
                          stance?.strong && "font-medium"
                        )}
                        title={stance ? tagStanceTitle(stance) : undefined}
                      >
                        {stance?.strong && <TagStanceMark stance={stance.stance} />}
                        {t}
                      </Badge>
                    )
                  })}
                </div>
              </section>
            )}

            {canonicalSynopsis && (
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 border-b border-border/30 pb-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary/80" />
                  <h3 className="text-xs font-semibold text-foreground">Sinopse Canônica</h3>
                </div>
                <div className="rounded-lg border border-border/40 bg-muted/20 p-3 leading-relaxed text-muted-foreground text-[11.5px] whitespace-pre-line">
                  {canonicalSynopsis}
                </div>
              </section>
            )}

            {reviewDigest && (
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 border-b border-border/30 pb-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-primary/80" />
                  <h3 className="text-xs font-semibold text-foreground">Digest de Reviews</h3>
                </div>

                <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-3 text-[11.5px] leading-relaxed">
                  {reviewDigest.consensus && (
                    <div>
                      <span className="font-semibold text-foreground mr-1.5">Consenso:</span>
                      <span className="text-muted-foreground">{reviewDigest.consensus}</span>
                    </div>
                  )}

                  {reviewDigest.divergence && (
                    <div>
                      <span className="font-semibold text-foreground mr-1.5">Divergência:</span>
                      <span className="text-muted-foreground">{reviewDigest.divergence}</span>
                    </div>
                  )}

                  {reviewDigest.execution && (
                    <div>
                      <span className="font-semibold text-foreground mr-1.5">Execução:</span>
                      <span className="text-muted-foreground">{reviewDigest.execution}</span>
                    </div>
                  )}

                  {reviewDigest.content_warnings && reviewDigest.content_warnings.length > 0 && (
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                      <div>
                        <span className="font-semibold text-rose-600 dark:text-rose-400 mr-1.5">Alertas:</span>
                        <span className="text-muted-foreground">{reviewDigest.content_warnings.join(", ")}</span>
                      </div>
                    </div>
                  )}

                  {reviewDigest.salient_traits && reviewDigest.salient_traits.length > 0 && (
                    <div className="pt-2.5 border-t border-border/30 mt-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Traços Marcantes
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {reviewDigest.salient_traits.map((t, i) => (
                          <Badge
                            key={`${t.trait}-${i}`}
                            variant="outline"
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-normal rounded-md border",
                              polarityClass(t.polarity)
                            )}
                            title={t.axis}
                          >
                            {t.trait}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
