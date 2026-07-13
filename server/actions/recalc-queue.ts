"use server"

// FACHADA de server actions do recálculo. Ver a nota em `@/server/recalc/queue`:
// num arquivo `"use server"` toda função exportada é um endpoint HTTP público, então
// `recalculateScoresNow`/`markRecalcPending`/`maybeTriggerStaleRecalc` (chamadas
// servidor-a-servidor, várias em background) NÃO entram aqui — só o que a UI chama.
//
// O gate de admin fica na implementação (`triggerRecalcNow`).

import * as impl from "@/server/recalc/queue"

export type { AiPendingCounts, RecalcPendingState } from "@/server/recalc/queue"

export async function getAiPendingCounts() {
  return impl.getAiPendingCounts()
}

export async function triggerRecalcNow() {
  return impl.triggerRecalcNow()
}
