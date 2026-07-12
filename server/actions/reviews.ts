"use server"

import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { startUpdateJob, finishUpdateJob } from "@/lib/background/update-jobs"

/**
 * Busca APENAS as reviews externas de uma obra (das fontes já vinculadas) e as
 * persiste — SEM passar pelo fluxo de "Atualizar dados" (busca de fontes, seleção de
 * sinopse/capa, conflitos). Roda em background (`after()`, ~35s por causa do Mangago)
 * e registra um job pra o `UpdateProgressWatcher` mostrar o progresso. A persistência
 * é incremental (por fonte), então uma interrupção no meio não perde tudo.
 */
export async function refetchWorkReviews(workId: string): Promise<{ ok: boolean }> {
  if (!workId) return { ok: false }
  startUpdateJob(workId)
  after(async () => {
    let reviewsAdded: number | undefined
    try {
      const sb = createAdminClient()
      const count = async (): Promise<number> =>
        (await sb
          .from("work_reviews")
          .select("id", { count: "exact", head: true })
          .eq("work_id", workId)).count ?? 0
      const before = await count()
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      await acquireAndPersistWorkReviews(workId)
      reviewsAdded = Math.max(0, (await count()) - before)
    } finally {
      finishUpdateJob(workId, { reviewsAdded })
    }
  })
  return { ok: true }
}
