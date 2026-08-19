/**
 * O que falta ANTES de mandar uma obra pra avaliação dos 9 atributos. PURO.
 *
 * ## Por que existe
 *
 * A avaliação lê `work_tags` no começo (`triggerAiEvaluation`) e só DEPOIS busca e
 * persiste as reviews frescas — e no fim zera `works.ai_eval_reviews_stale`. Ou seja:
 * avaliar uma obra da fila "Reviews novas" a **tira da fila sem nunca ter reinferido
 * as tags** com aquelas reviews, e o único sinal que apontava pro problema é apagado
 * pela própria ação. Era isso que obrigava a abrir obra por obra antes de avaliar.
 *
 * ## Os números que decidiram o desenho (clone local, 2026-08-19)
 *
 * Fila "Reviews novas" — 552 obras não-puladas:
 *
 * | | obras | % |
 * |---|---|---|
 * | tags anteriores ao contexto de reviews atual | 422 | **76,4%** |
 * | sem `comix` e/ou `mangago` vinculado | 110 | 19,9% |
 * | **prontas pra avaliar sem preparo** | **37** | **6,7%** |
 * | <4 reviews úteis (piso do digest) | 26 | 4,7% |
 *
 * 🔴 **93% precisam de preparo ⇒ o preparo é o caminho PADRÃO, não um aviso.** Um chip
 * "faltam tags" acenderia em 3 de cada 4 cards, que é o alarme que sempre toca — a mesma
 * régua que mantém "Reviews novas" (57% do catálogo) fora do badge da barra. O que é
 * maioria vira COMPORTAMENTO; só o raro vira chip.
 */

import type { SourceLinkState } from "@/lib/external/source-link-state"

/**
 * As fontes que de fato carregam a evidência. **Medido**, não escolhido — no clone
 * local (2026-08-19), reviews persistidas por fonte:
 *
 * | fonte | vínculos | reviews | por vínculo |
 * |---|---|---|---|
 * | **mangago** | 805 | **19.234** | 23,9 |
 * | **comix** | 985 | **14.921** | 15,1 |
 * | mangaupdates | 972 | 2.768 | 2,8 |
 * | mangadex · animeplanet · myanimelist · kitsu | — | 1.001–2.206 | 1,6–3,0 |
 * | comick · anilist | 853 · 902 | 641 · **73** | 0,8 · **0,1** |
 *
 * As duas primeiras somam **34.155 de 43.789 reviews — 78%**. Avaliar sem elas é avaliar
 * com um quinto da evidência, e o modelo não tem como saber que faltou.
 *
 * ⚠️ São justamente as duas atrás de Cloudflare (sidecar/FlareSolverr). "Sem vínculo" aqui
 * é lacuna de CURADORIA (`gap`), não fonte fora do ar — quem classifica é
 * `classifySourceLink`, e queda de infra não vira `gap`.
 */
export const MAIN_REVIEW_SOURCES = ["comix", "mangago"] as const
export type MainReviewSource = (typeof MAIN_REVIEW_SOURCES)[number]

export interface EvalPrepInput {
  /** Estado de cada fonte principal. Ausente do mapa = `gap` (nunca avaliada). */
  sourceStates: Partial<Record<MainReviewSource, SourceLinkState>>
  /** `works.tags_inferred_at` — null = a inferência nunca rodou nesta obra. */
  tagsInferredAt: string | null
  /** `works.review_digest_at` */
  reviewDigestAt: string | null
  /** `works.review_summary_at` */
  reviewSummaryAt: string | null
}

export interface EvalPrep {
  /** Fontes principais em `gap` — nem vinculadas, nem declaradas ausentes. */
  missingSources: MainReviewSource[]
  /** Falta fonte principal ⇒ a avaliação não roda (escolha da Ana, 2026-08-19). */
  blocked: boolean
  /** As tags são anteriores ao contexto de reviews que a inferência lê. */
  needsTagRefresh: boolean
  /**
   * ⚠️ **Não existe `lowEvidence` aqui, e é DECISÃO medida — não esquecimento.** Ver a
   * seção "A fila de atributos PREPARA antes de avaliar" no CLAUDE.md: o piso de 4
   * reviews úteis foi medido para o DIGEST, e reusá-lo como julgamento sobre a
   * avaliação de atributo é aplicar régua de outro artefato.
   */
  /** Nada a preparar: pode avaliar direto. */
  ready: boolean
}

/**
 * Quando o contexto de reviews que a INFERÊNCIA DE TAGS lê foi produzido.
 *
 * 🔴 É `review_digest_at`/`review_summary_at`, **nunca** a data da review mais nova —
 * e a diferença não é cosmética. `inferAndPersistTagsForWork` lê
 * `works.review_digest` e `works.review_summary` (via `buildReviewContext`), não
 * `work_reviews`. Medido na mesma fila de 552: a régua por review crua acusa **502
 * obras (90,9%)** e esta acusa **422 (76,4%)**. As 80 de diferença são obras cujas
 * reviews chegaram mas cujo digest o gate de materialidade (crescimento ≥ max(2, 20%))
 * NÃO regerou — reinferir tags ali releria o mesmo texto e produziria as mesmas tags,
 * a 0,99¢ por obra. A régua barata é também a correta.
 *
 * ⚠️ Ela é uma FOTO do que já está no banco. Depois de adquirir reviews o digest pode
 * ter sido regerado, então quem prepara precisa reclassificar — ver `prepareAndEvaluate`.
 */
export function reviewContextAt(input: {
  reviewDigestAt: string | null
  reviewSummaryAt: string | null
}): string | null {
  const candidatos = [input.reviewDigestAt, input.reviewSummaryAt].filter(
    (v): v is string => Boolean(v),
  )
  if (candidatos.length === 0) return null
  // ISO-8601 UTC ordena lexicograficamente — é como o resto do projeto compara carimbo.
  return candidatos.sort()[candidatos.length - 1]
}

/** A régua, num lugar só: o card, o rótulo do botão e a action derivam daqui. */
export function classifyEvalPrep(input: EvalPrepInput): EvalPrep {
  const missingSources = MAIN_REVIEW_SOURCES.filter(
    (source) => (input.sourceStates[source] ?? "gap") === "gap",
  )
  const contextoEm = reviewContextAt(input)
  // Nunca inferiu ⇒ precisa, sempre. Inferiu ⇒ precisa só se o contexto é mais novo.
  // Obra sem digest E sem resumo (6 no catálogo) que já inferiu NÃO precisa: não há
  // contexto novo pra ler, e marcar aqui gastaria 0,99¢ pra reler só a sinopse.
  const needsTagRefresh = !input.tagsInferredAt
    ? true
    : contextoEm != null && contextoEm > input.tagsInferredAt

  const blocked = missingSources.length > 0
  return {
    missingSources,
    blocked,
    needsTagRefresh,
    ready: !blocked && !needsTagRefresh,
  }
}
