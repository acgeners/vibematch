"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { regenerateCalibratedArtifacts } from "@/server/actions/calibration"

const TASK_ID = "regen-calibrated-artifacts"

/**
 * Dispara a regeneração dos artefatos calibrados (Fase 1.5.5): reconstrói o
 * TasteProfile sobre atributos calibrados, marca os alignment_score como stale
 * e recalcula toda a base com o offset atual. Use após coletar/alterar bias.
 *
 * Vai pelo `runTask`: é durável (grava perfil + recalcula a base inteira) e das
 * mais longas da console — recalcular tudo sozinho já lê o catálogo completo.
 */
export function RegenerateCalibratedArtifactsButton() {
  const tasks = useAppTasks()
  const isPending = tasks.some((t) => t.id === TASK_ID && t.status === "running")

  const handleClick = () => {
    runTask({
      id: TASK_ID,
      kind: "regen-calibrated",
      label: "Regenerando artefatos calibrados",
      run: async () => {
        const result = await regenerateCalibratedArtifacts()
        // `{ ok: false }` em vez de exceção — sem converter, o store diria
        // "pronto" pra uma falha.
        if (!result.ok) throw new Error(result.error)
        return result
      },
      successToast: (result) => ({
        message: `Artefatos regenerados: TasteProfile ${
          result.tasteProfileRegenerated ? "reconstruído" : "(stub)"
        }, ${result.worksRecalculated} obras recalculadas, ${
          result.alignmentRowsMarkedStale
        } alignments marcados pra refresh.`,
      }),
    })
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      <RefreshCw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {isPending ? "Regenerando…" : "Regenerar artefatos calibrados"}
    </Button>
  )
}
