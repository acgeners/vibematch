import { estimateStepUsd } from "@/lib/orchestration/cost"
import type { ActionName } from "@/lib/orchestration/contracts"

/**
 * Custo estimado do "Gerar tudo" — DONO ÚNICO. A confirmação da cascata
 * (`generateAllWorkData`) e o cartão do botão na página da obra mostram este número;
 * calculado em dois lugares, os dois divergiriam na primeira mudança de passo.
 */

// Passos PAGOS da cascata. Embedding é free (OpenAI ~$0). `enrich_tags` é proxy de custo
// da inferência de tags (Haiku).
const CASCADE_PAID_ACTIONS: ActionName[] = [
  "consolidate_synopsis",
  "enrich_tags",
  "generate_review_summary",
  "generate_review_digest",
  "run_ai_evaluation",
  "predict_interest_potential",
  "run_alignment",
]

export function estimateCascadeUsd(): number {
  return CASCADE_PAID_ACTIONS.reduce((sum, a) => sum + estimateStepUsd(a, 1), 0)
}
