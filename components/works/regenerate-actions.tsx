"use client"

import { Sparkles } from "lucide-react"
import { TaskButton } from "@/components/ai-evaluation/task-button"
import { regenerateCanonicalSynopsis, type RegenerateSynopsisResult } from "@/server/actions/ai-eval-maintenance"

/**
 * Botão de RE-geração da sinopse canônica de uma obra.
 *
 * Existe porque a canônica é cacheada por um hash das ENTRADAS
 * (`canonical_synopsis_inputs_hash`). Quando as fontes não mudam, o pipeline
 * devolve "fresh" e nunca refaz — o que está certo no dia a dia, e errado
 * depois de uma troca de prompt ou de modelo. O botão fura o gate com `force`,
 * e por isso é explicitamente manual: quem clica está dizendo "eu sei que a
 * entrada é a mesma, refaça mesmo assim".
 *
 * Molde: `TagRowAction` (components/ai-evaluation/tag-actions.tsx) — mesmo
 * `TaskButton`, mesmo popup de custo, mesma variante ghost para header de card.
 *
 * O equivalente do DIGEST já existe e não foi duplicado aqui: vive dentro do
 * `WorkReviewsCard` (`runGenerate(true)`), com tooltip e confirmação próprios.
 */
export function RegenerateSynopsisAction({
  workId,
  variant = "ghost",
  label = "Regerar",
  size = "sm",
  className,
}: {
  workId: string
  variant?: "default" | "outline" | "secondary" | "ghost"
  label?: string
  size?: "sm" | "default"
  className?: string
}) {
  return (
    <TaskButton
      taskId={`regen-synopsis:${workId}`}
      kind="regen-synopsis"
      label={label}
      busyLabel="Regerando…"
      variant={variant}
      size={size}
      className={className}
      icon={<Sparkles className="h-3.5 w-3.5" />}
      cost={{ action: "consolidate_synopsis" }}
      run={() => regenerateCanonicalSynopsis(workId)}
      formatDone={(r) => {
        const x = r as RegenerateSynopsisResult
        return { ok: x.ok, message: x.message ?? (x.ok ? "Sinopse regerada" : "Falhou") }
      }}
    />
  )
}
