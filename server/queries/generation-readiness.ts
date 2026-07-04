/**
 * Prontidão de um gerador pra UMA obra, pronta pra UI. Junta as 3 peças:
 *   loader (DB → snapshot) → buildPlan (motor) → toUiReadiness (3 níveis + selo).
 * O resultado é serializável — passa de Server Component pro botão client.
 */
import "server-only"
import { buildPlan, type ActionName } from "@/lib/orchestration"
import { loadWorkReadinessSnapshot } from "@/lib/orchestration/integrations/readiness-loader"
import { toUiReadiness, type UiReadiness } from "@/lib/orchestration/ui-readiness"

export async function getGenerationReadiness(
  workId: string,
  action: ActionName,
): Promise<UiReadiness> {
  const snapshot = await loadWorkReadinessSnapshot(workId)
  const plan = buildPlan(action, snapshot)
  return toUiReadiness(action, plan, snapshot)
}

/** Vários geradores pra a MESMA obra — carrega o snapshot UMA vez só. */
export async function getGenerationReadinessMany(
  workId: string,
  actions: ActionName[],
): Promise<Record<string, UiReadiness>> {
  const snapshot = await loadWorkReadinessSnapshot(workId)
  const out: Record<string, UiReadiness> = {}
  for (const action of actions) out[action] = toUiReadiness(action, buildPlan(action, snapshot), snapshot)
  return out
}

export type { UiReadiness } from "@/lib/orchestration/ui-readiness"
