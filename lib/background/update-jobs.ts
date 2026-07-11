import "server-only"

/**
 * Registro EM MEMÓRIA dos jobs de background do "Atualizar dados" — a aquisição de
 * reviews (+ enrich do Comix) que roda em `after()`, fora do caminho da requisição.
 * Serve pra a página da obra dar feedback visual (UpdateProgressWatcher) de que o
 * processo terminou, já que o Mangago é lento (~60s) e o usuário recarregaria às
 * cegas.
 *
 * NÃO é durável de propósito: vive só no processo e some no restart (o watcher no
 * cliente degrada gracioso via timeout). É um sinal efêmero de "terminou", não uma
 * fila. TTL curto pra não vazar memória.
 */
export type UpdateJobState = "running" | "done"

export interface UpdateJob {
  state: UpdateJobState
  startedAt: number
  finishedAt?: number
  /** Reviews NOVAS persistidas nesta rodada (delta), quando a aquisição rodou. */
  reviewsAdded?: number
}

const JOB_TTL_MS = 5 * 60_000
const jobs = new Map<string, UpdateJob>()

function sweep(now: number): void {
  for (const [id, job] of jobs) {
    const ref = job.finishedAt ?? job.startedAt
    if (now - ref > JOB_TTL_MS) jobs.delete(id)
  }
}

/** Marca o início do job de background de uma obra ("Atualizar dados"). */
export function startUpdateJob(workId: string): void {
  if (!workId) return
  const now = Date.now()
  sweep(now)
  jobs.set(workId, { state: "running", startedAt: now })
}

/** Marca o fim do job; `reviewsAdded` = delta de reviews persistidas nesta rodada. */
export function finishUpdateJob(workId: string, opts: { reviewsAdded?: number } = {}): void {
  if (!workId) return
  const existing = jobs.get(workId)
  jobs.set(workId, {
    state: "done",
    startedAt: existing?.startedAt ?? Date.now(),
    finishedAt: Date.now(),
    reviewsAdded: opts.reviewsAdded,
  })
}

export function getUpdateJob(workId: string): UpdateJob | null {
  if (!workId) return null
  sweep(Date.now())
  return jobs.get(workId) ?? null
}
