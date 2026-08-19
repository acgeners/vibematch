"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { acquireAndPersistWorkReviews } from "@/lib/external/acquire-reviews"
import { inferAndPersistTagsForWork } from "@/lib/tags/auto-infer"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import { triggerAiEvaluation } from "@/server/actions/ai"
import { loadEvalPrepForWork } from "@/server/queries/eval-prep"
import { ensureAdmin } from "@/server/queries/current-user"
import type { MainReviewSource } from "@/lib/ai-evaluation/eval-readiness"

/** O que o preparo fez de fato — o lote soma isto pra dizer o que aconteceu. */
export interface PrepSummary {
  reviews: number
  digest: string
  /** null = a régua disse que as tags já estavam em dia (nenhuma chamada paga). */
  tagsAdded: number | null
}

export type PrepareAndEvaluateResult =
  /** Falta fonte principal: NÃO avalia, e nada foi gasto. */
  | { kind: "blocked_sources"; missingSources: MainReviewSource[] }
  /** Preparou e avaliou — `result` é o retorno cru de `triggerAiEvaluation`. */
  | { kind: "evaluated"; prep: PrepSummary; result: Awaited<ReturnType<typeof triggerAiEvaluation>> }
  | { kind: "error"; error: string }

/**
 * Prepara a obra e avalia os 9 atributos, na ordem em que os dados dependem uns dos
 * outros: **fontes → reviews (+digest) → tags → avaliação**.
 *
 * ## Por que existe
 *
 * `triggerAiEvaluation` sozinha lê `work_tags` ANTES de buscar as reviews frescas, e no
 * fim zera `works.ai_eval_reviews_stale`. A obra sai da fila "Reviews novas" com as
 * tags que ela tinha antes daquelas reviews, e o sinal que apontaria isso é apagado
 * pela própria ação. Medido: só **6,7%** da fila estão prontas pra avaliar sem preparo.
 *
 * ## Por que a ordem é essa, e não outra
 *
 * `inferAndPersistTagsForWork` lê `works.review_digest`/`review_summary` — não
 * `work_reviews`. Então o digest tem que estar pronto ANTES da inferência, e por isso
 * o passo 2 **aguarda** `generateWorkReviewDigest` em vez de deixá-lo no fire-and-forget
 * que `saveWorkReviews` faz por padrão.
 *
 * ## O que isso custa a mais que "Avaliar" (medido em `ai_api_calls`)
 *
 * | passo | custo | p50 |
 * |---|---|---|
 * | aquisição de reviews | US$0 (scraping) | — |
 * | `review_digest` | 1,83¢ | 13,5s |
 * | `tag_inference` | **0,99¢** | 7,6s |
 * | `ai_evaluation` | 3,81¢ | 17,8s |
 *
 * 🔴 **O gasto NOVO é só a inferência de tags.** O digest já roda hoje dentro da
 * avaliação (`saveWorkReviews` dispara resumo+digest sob gate de materialidade), e a
 * aquisição do passo 2 cai no cache de contexto externo de 5 min que a avaliação do
 * passo 4 consulta — a chave bate exatamente, porque os dois caminhos usam
 * `{ total: 30, maxPerSource: 12 }` (`AI_EVAL_REVIEW_CAPS` × o default do cache). Preparar
 * antes NÃO paga o scraping duas vezes.
 *
 * ⚠️ **A prontidão é reclassificada DEPOIS do passo 2**, nunca reusada da tela: adquirir
 * reviews pode ter regerado o digest, e é justamente esse caso que torna a inferência
 * necessária. Decidir com a foto antiga puliria a obra que mais precisa.
 */
export async function prepareAndEvaluate(
  workId: string,
  opts: { proceedWithoutReviews?: boolean; ignoreSourceGate?: boolean } = {},
): Promise<PrepareAndEvaluateResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { kind: "error", error: gate.error }
  if (!workId) return { kind: "error", error: "Obra inválida." }

  const antes = await loadEvalPrepForWork(workId)

  // 1. Fontes principais. Bloqueia ANTES de qualquer chamada paga — mangago e comix
  // carregam 78% das reviews do catálogo, e avaliar sem elas é avaliar com um quinto
  // da evidência sem que nada acuse. O destravamento é manual por medição: casamento
  // automático por título erra 7%, e `absent` é permanente (ver a aba Fontes).
  if (antes.blocked && !opts.ignoreSourceGate) {
    return { kind: "blocked_sources", missingSources: antes.missingSources }
  }

  // 2. Reviews + digest. Grátis (scraping); o digest tem gate próprio de materialidade,
  // então re-rodar numa obra sem reviews novas não gasta nada.
  const reviews = await acquireAndPersistWorkReviews(workId)
  const digest = await generateWorkReviewDigest(workId)

  // 3. Tags — só se o contexto de reviews ficou mais novo que a última inferência.
  const depois = await loadEvalPrepForWork(workId)
  const tagsAdded = depois.needsTagRefresh ? await inferAndPersistTagsForWork(workId) : null

  // 4. Avaliação — agora lendo as tags recém-inferidas.
  const result = await triggerAiEvaluation(workId, {
    proceedWithoutReviews: opts.proceedWithoutReviews,
  })

  revalidatePath("/curation/works")
  revalidateTag("ai-eval-tab-counts", "max")
  return { kind: "evaluated", prep: { reviews, digest: digest.status, tagsAdded }, result }
}
