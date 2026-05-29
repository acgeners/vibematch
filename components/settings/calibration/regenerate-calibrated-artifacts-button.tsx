"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { regenerateCalibratedArtifacts } from "@/server/actions/calibration"

/**
 * Dispara a regeneração dos artefatos calibrados (Fase 1.5.5): reconstrói o
 * TasteProfile sobre atributos calibrados, marca os alignment_score como stale
 * e recalcula toda a base com o offset atual. Use após coletar/alterar bias.
 */
export function RegenerateCalibratedArtifactsButton() {
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await regenerateCalibratedArtifacts()
          if (result.ok) {
            toast.success(
              `Artefatos regenerados: TasteProfile ${
                result.tasteProfileRegenerated ? "reconstruído" : "(stub)"
              }, ${result.worksRecalculated} obras recalculadas, ${
                result.alignmentRowsMarkedStale
              } alignments marcados pra refresh.`,
            )
          } else {
            toast.error(result.error)
          }
        })
      }
    >
      <RefreshCw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {isPending ? "Regenerando…" : "Regenerar artefatos calibrados"}
    </Button>
  )
}
