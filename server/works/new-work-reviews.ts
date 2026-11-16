import "server-only"
import type { SourcedReview } from "@/lib/external/types"

/** Passos que dependem do contexto de quem criou a obra (gates de configuração, Comix). */
export interface NewWorkReviewSteps {
  /** Espera a descoberta do hid da Comix (no-op quando não há como descobrir). */
  comixHidReady: () => Promise<unknown>
  /** Inferência de tags da obra nova, com os gates de configuração de quem chama. */
  inferTags: (workId: string) => Promise<void>
}

/**
 * Reviews de uma obra recém-criada, na ORDEM certa: dono único, usado pela criação de uma obra
 * e pelo lote. Roda em `after()` — leva ~1 min e não pode segurar a resposta.
 *
 *  1. o recorte que a avaliação do "Buscar dados" leu (quando houve avaliação), gravado com a
 *     data dela e SEM gerar nada pago;
 *  2. o hid da Comix — sem ele a Comix fica fora do pool e de tudo que sai dele;
 *  3. a busca completa em todas as fontes vinculadas, que gera resumo e digest UMA vez, já
 *     sobre o pool inteiro;
 *  4. as tags, que leem o digest.
 *
 * 🔴 Até 2026-11-16 a obra avaliada na criação pulava os passos 2 e 3: resumo, digest e tags
 * saíam só do recorte da busca rápida, e a pergunta "Salvar e enriquecer" não esperava as
 * reviews. Se a busca completa voltar vazia (fontes fora), o pago é gerado sobre o recorte,
 * que era o comportamento anterior — senão a obra ficaria sem resumo e sem digest.
 */
export async function acquireReviewsForNewWork(
  workId: string,
  evaluatedPool: SourcedReview[] | null | undefined,
  opts: { skipPaidEnrichment: boolean },
  steps: NewWorkReviewSteps,
): Promise<void> {
  const { saveWorkReviews } = await import("@/lib/external/persist-reviews")
  const recorte = evaluatedPool && evaluatedPool.length > 0 ? evaluatedPool : null
  if (recorte) {
    // fromFreshEval: a obra acabou de ser avaliada com estas reviews ⇒ não a marca como
    // desatualizada nem conta estas linhas como "+N desde a avaliação".
    await saveWorkReviews(workId, recorte, { fromFreshEval: true, skipPaidEnrichment: true })
  }
  await steps.comixHidReady()
  const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
  const pool = await acquireAndPersistWorkReviews(workId, {
    skipPaidEnrichment: opts.skipPaidEnrichment,
    awaitDigest: true,
  })
  if (pool === 0 && recorte) {
    await saveWorkReviews(workId, recorte, {
      fromFreshEval: true,
      skipPaidEnrichment: opts.skipPaidEnrichment,
      awaitDigest: true,
    })
  }
  await steps.inferTags(workId)
}
