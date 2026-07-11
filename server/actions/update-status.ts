"use server"

import { getUpdateJob } from "@/lib/background/update-jobs"

/**
 * Status do job de background do "Atualizar dados" de uma obra (aquisição de
 * reviews + enrich do Comix). Consultado pelo `UpdateProgressWatcher` (poll) pra
 * avisar quando terminou. `idle` = sem job (nada rodando ou já expirou/reiniciou).
 */
export async function getWorkUpdateStatus(
  workId: string,
): Promise<{ state: "running" | "done" | "idle"; reviewsAdded?: number }> {
  const job = getUpdateJob(workId)
  if (!job) return { state: "idle" }
  return { state: job.state, reviewsAdded: job.reviewsAdded }
}
