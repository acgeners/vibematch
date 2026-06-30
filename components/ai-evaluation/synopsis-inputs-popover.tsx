"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

function polarityClass(polarity: "positive" | "negative" | "mixed"): string {
  if (polarity === "positive") return "border-emerald-300 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300"
  if (polarity === "negative") return "border-rose-300 text-rose-700 dark:border-rose-400/30 dark:text-rose-300"
  return "border-amber-300 text-amber-700 dark:border-amber-400/30 dark:text-amber-300"
}

/**
 * Popover que mostra os INPUTS usados pra prever o Interesse na sinopse: tags
 * agrupadas, sinopse canônica e digest de reviews (consenso/traços/alertas) —
 * exatamente o que o preditor recebe. Trigger discreto "inputs da previsão".
 */
export function SynopsisInputsPopover({
  canonicalSynopsis,
  tags,
  reviewDigest,
}: {
  canonicalSynopsis?: string | null
  tags?: string[]
  reviewDigest?: ReviewDigest | null
}) {
  const hasAny = !!(canonicalSynopsis || (tags && tags.length) || reviewDigest)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3 w-3" /> inputs da previsão
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[28rem] w-96 overflow-y-auto text-xs">
        {!hasAny ? (
          <p className="text-muted-foreground">Sem inputs hidratados para esta obra.</p>
        ) : (
          <div className="space-y-3">
            {tags && tags.length > 0 && (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tags ({tags.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[11px] font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {canonicalSynopsis && (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Sinopse canônica
                </p>
                <p className="whitespace-pre-line leading-5 text-muted-foreground">{canonicalSynopsis}</p>
              </section>
            )}

            {reviewDigest && (
              <section className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Digest de reviews
                </p>
                {reviewDigest.consensus && (
                  <p>
                    <span className="font-medium text-foreground">Consenso:</span> {reviewDigest.consensus}
                  </p>
                )}
                {reviewDigest.divergence && (
                  <p>
                    <span className="font-medium text-foreground">Divergência:</span> {reviewDigest.divergence}
                  </p>
                )}
                {reviewDigest.salient_traits && reviewDigest.salient_traits.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {reviewDigest.salient_traits.map((t, i) => (
                      <Badge
                        key={`${t.trait}-${i}`}
                        variant="outline"
                        className={cn("text-[11px] font-normal", polarityClass(t.polarity))}
                        title={t.axis}
                      >
                        {t.trait}
                      </Badge>
                    ))}
                  </div>
                )}
                {reviewDigest.content_warnings && reviewDigest.content_warnings.length > 0 && (
                  <p>
                    <span className="font-medium text-foreground">Alertas:</span>{" "}
                    {reviewDigest.content_warnings.join(", ")}
                  </p>
                )}
                {reviewDigest.execution && (
                  <p>
                    <span className="font-medium text-foreground">Execução:</span> {reviewDigest.execution}
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
