"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ExternalListImport } from "@/components/import/external-list-import"
import { ImportReview } from "@/components/titles/import-review"
import type { ReviewWork } from "@/server/actions/enrich"

type Mode = "external" | "review"

export function ImportModes({ pendingReviewWorks }: { pendingReviewWorks: ReviewWork[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("external")
  // Obras revisadas nesta sessão — somem da contagem/aba de pendentes.
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const pendingCount = pendingReviewWorks.filter((w) => !reviewed.has(w.id)).length
  // Mostra a aba de revisão se há pendentes OU se o usuário está nela (pra não
  // sumir bruscamente ao revisar a última — exibe o estado vazio 🎉).
  const showReview = pendingCount > 0 || mode === "review"

  const modes: { id: Mode; label: string }[] = [
    { id: "external", label: "Listas externas" },
    ...(showReview
      ? [{ id: "review" as Mode, label: `Revisar pendentes (${pendingCount})` }]
      : []),
  ]

  return (
    <div className="space-y-6">
      {modes.length > 1 && (
        <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-[3px]">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition",
                mode === m.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {mode === "external" && (
        <ExternalListImport
          onReviewBatchComplete={() => {
            // Lote de "Buscar dados das sem capa" terminou → atualiza as
            // pendentes (servidor) e vai pra aba "Revisar pendentes".
            router.refresh()
            setMode("review")
          }}
        />
      )}
      {mode === "review" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Obras importadas pendentes de avaliação. Busque capa/sinopses das que estão sem capa e confira o que veio das fontes. As notas dos atributos são geradas na Avaliação IA.
          </p>
          <ImportReview
            works={pendingReviewWorks}
            onReviewed={(id) => setReviewed((prev) => new Set(prev).add(id))}
          />
        </div>
      )}
    </div>
  )
}
