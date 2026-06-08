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
  const hasReview = pendingReviewWorks.length > 0
  // Se o modo selecionado deixou de existir (revisou tudo), cai pra "external".
  const activeMode: Mode = mode === "review" && !hasReview ? "external" : mode

  const modes: { id: Mode; label: string }[] = [
    { id: "external", label: "Listas externas" },
    ...(hasReview
      ? [{ id: "review" as Mode, label: `Revisar pendentes (${pendingReviewWorks.length})` }]
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
                activeMode === m.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {activeMode === "external" && (
        <ExternalListImport
          onReviewBatchComplete={() => {
            // Lote de "Buscar dados das sem capa" terminou → atualiza as
            // pendentes (servidor) e vai pra aba "Revisar pendentes".
            router.refresh()
            setMode("review")
          }}
        />
      )}
      {activeMode === "review" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Obras importadas pendentes de avaliação. Busque capa/sinopses das que estão sem capa e confira o que veio das fontes. As notas dos atributos são geradas na Avaliação IA.
          </p>
          <ImportReview works={pendingReviewWorks} />
        </div>
      )}
    </div>
  )
}
