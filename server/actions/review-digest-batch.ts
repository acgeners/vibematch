"use server"

import { revalidatePath } from "next/cache"
import { ensureReviewDigest } from "@/lib/orchestration/integrations/reviews"
import { ensureAdmin } from "@/server/queries/current-user"
import { DIGEST_BATCH_MAX } from "@/lib/reviews/digest-gate"

export interface DigestBatchProgress {
  attempted: number
  generated: number
  /** Já estava em dia, ou a mudança não era material — não custou nada. */
  skipped: number
  /** Barrada pelo piso de reviews. Não deveria acontecer pela UI (a aba não
   *  oferece), mas o servidor não confia na tela: `"use server"` é endpoint
   *  público, e a lista de ids vem do cliente. */
  blocked: number
  failed: number
  costUsd: number
}

/**
 * Gera o digest de uma seleção de obras — o lote da aba "Digests".
 *
 * 🔴 **Passa por `ensureReviewDigest`, e isso é o ponto.** O lote anterior
 * (`consolidatePendingReviewDigests`, no /settings) chamava o consolidador DIRETO:
 * tinha corpus próprio (só `work_reviews`, ignorando as reviews manuais externas
 * que o caminho por obra inclui), nenhum gate de readiness e nenhuma dedup de job.
 * Eram dois caminhos para o mesmo artefato, divergindo em silêncio — e o piso de
 * reviews teria que ser escrito duas vezes pra valer nos dois. Este passa pelo
 * MESMO caminho do botão da página da obra.
 *
 * ⚠️ **`allowPaid: true` porque o clique já foi confirmado no modal de custo** —
 * mesma pré-autorização do botão por obra. Sem isso o gate devolveria
 * `blocked_cost_confirmation` para cada obra e o lote inteiro viraria no-op.
 *
 * ⚠️ Sem `force`: obra que já está em dia é pulada de graça. Quem quer regerar por
 * cima usa o botão da própria obra, que é onde essa decisão tem contexto.
 */
export async function generateDigestsForWorks(
  workIds: string[],
): Promise<{ data?: DigestBatchProgress; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }

  const ids = workIds.slice(0, DIGEST_BATCH_MAX)
  const progress: DigestBatchProgress = {
    attempted: 0,
    generated: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
    costUsd: 0,
  }

  // Sequencial de propósito: são chamadas Sonnet de ~20s e o teto é 10. Em
  // paralelo, um pico de rate limit da Anthropic derrubaria o lote inteiro em vez
  // de uma obra.
  for (const id of ids) {
    progress.attempted += 1
    try {
      const outcome = await ensureReviewDigest(id, { allowPaid: true })
      switch (outcome.status) {
        case "succeeded":
          progress.generated += 1
          progress.costUsd += outcome.costUsd
          break
        case "skipped":
          progress.skipped += 1
          break
        case "not_ready":
          progress.blocked += 1
          break
        case "processing":
          // Job durável já em voo (outra aba, ou clique repetido): não é falha.
          progress.skipped += 1
          break
        default:
          progress.failed += 1
      }
    } catch (err) {
      console.error("[generateDigestsForWorks] obra", id, err)
      progress.failed += 1
    }
  }

  if (progress.generated > 0) revalidatePath("/ai-evaluation")
  return { data: progress }
}
