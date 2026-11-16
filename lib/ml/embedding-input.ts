/**
 * Constrói o texto canônico que vai ser embedado e seu hash determinístico.
 *
 * O hash é usado pra invalidar embeddings antigos quando a sinopse, tags ou
 * critérios mudam — re-embeda só o que precisa. Ordem alfabética em tudo
 * pra garantir que reorganizações não-semânticas (ex: mudar ordem das tags)
 * não invalidem o cache.
 */

import { createHash } from "node:crypto"
import type { CategoryScoreMap, CriterionSlug } from "@/types/domain"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"

/**
 * 🔴 SEM o título, de propósito (v3, 2026-11-16). Com ele, 25% das 8 obras mais parecidas de
 * cada obra dividiam uma palavra do título com ela (ao acaso: 2%; entre as de notas parecidas:
 * 3%) — as 8 de "The Villainess Is a Marionette" eram todas "The Villainess …". Sem o título,
 * medido com os vetores gerados de verdade: 8%, o resto que a premissa da sinopse explica.
 * O nome da obra não diz nada sobre ela; não devolva o campo.
 */
export interface EmbeddingInputData {
  synopsis: string | null
  tags: Array<{ name: string; group: string | null }>
  categoryScores: CategoryScoreMap
  /**
   * Texto destilado das reviews (digest preferido, resumo como fallback) já
   * serializado por `buildReviewContext`. Preference-agnostic — não vaza gosto.
   * Null/ausente em obras sem reviews → bloco "(nenhuma)".
   */
  reviewContext?: string | null
}

export interface BuiltEmbeddingInput {
  text: string
  hash: string
}

// v2: passou a incluir o bloco "Reviews" (digest/resumo) no texto embedado.
// v3: o título saiu do texto (ver `EmbeddingInputData`). Trocar a versão marca o catálogo
// inteiro como desatualizado: o "Atualizar embeddings" re-embeda tudo (~US$0,02).
const HASH_VERSION = "v3"

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

export function buildEmbeddingInput(data: EmbeddingInputData): BuiltEmbeddingInput {
  const tagsSorted = [...data.tags]
    .filter((t) => t.name)
    .map((t) => `${(t.group ?? "").trim()}::${t.name.trim()}`)
    .sort()

  const criteria = SCORING_CRITERION_SLUGS.map((slug) => {
    const v = data.categoryScores[slug as CriterionSlug]
    return v != null && Number.isFinite(v) ? `${slug}=${v.toFixed(1)}` : null
  })
    .filter((s): s is string => s !== null)
    .sort()

  const synopsis = data.synopsis ? normalizeText(data.synopsis) : "(sem sinopse)"
  const reviews = data.reviewContext ? normalizeText(data.reviewContext) : null

  const text = [
    `Sinopse: ${synopsis}`,
    tagsSorted.length > 0 ? `Tags: ${tagsSorted.join(", ")}` : "Tags: (nenhuma)",
    criteria.length > 0 ? `Critérios: ${criteria.join(", ")}` : "Critérios: (nenhum)",
    reviews ? `Reviews: ${reviews}` : "Reviews: (nenhuma)",
  ].join("\n")

  // Hash inclui versão pra forçar reembed se a fórmula mudar (ex: futura
  // adição de gêneros, sinônimos, etc.).
  const hash = createHash("sha256")
    .update(`${HASH_VERSION}\n${text}`)
    .digest("hex")

  return { text, hash }
}
