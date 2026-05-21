/**
 * Constrói o texto canônico que vai ser embedado e seu hash determinístico.
 *
 * O hash é usado pra invalidar embeddings antigos quando a sinopse, tags ou
 * critérios mudam — re-embeda só o que precisa. Ordem alfabética em tudo
 * pra garantir que reorganizações não-semânticas (ex: mudar ordem das tags)
 * não invalidem o cache.
 */

import { createHash } from "node:crypto"
import { CRITERION_SLUGS, type CategoryScoreMap, type CriterionSlug } from "@/types/domain"

export interface EmbeddingInputData {
  title: string
  synopsis: string | null
  tags: Array<{ name: string; group: string | null }>
  categoryScores: CategoryScoreMap
}

export interface BuiltEmbeddingInput {
  text: string
  hash: string
}

const HASH_VERSION = "v1"

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

export function buildEmbeddingInput(data: EmbeddingInputData): BuiltEmbeddingInput {
  const tagsSorted = [...data.tags]
    .filter((t) => t.name)
    .map((t) => `${(t.group ?? "").trim()}::${t.name.trim()}`)
    .sort()

  const criteria = CRITERION_SLUGS.map((slug) => {
    const v = data.categoryScores[slug as CriterionSlug]
    return v != null && Number.isFinite(v) ? `${slug}=${v.toFixed(1)}` : null
  })
    .filter((s): s is string => s !== null)
    .sort()

  const synopsis = data.synopsis ? normalizeText(data.synopsis) : "(sem sinopse)"

  const text = [
    `Título: ${normalizeText(data.title)}`,
    `Sinopse: ${synopsis}`,
    tagsSorted.length > 0 ? `Tags: ${tagsSorted.join(", ")}` : "Tags: (nenhuma)",
    criteria.length > 0 ? `Critérios: ${criteria.join(", ")}` : "Critérios: (nenhum)",
  ].join("\n")

  // Hash inclui versão pra forçar reembed se a fórmula mudar (ex: futura
  // adição de gêneros, sinônimos, etc.).
  const hash = createHash("sha256")
    .update(`${HASH_VERSION}\n${text}`)
    .digest("hex")

  return { text, hash }
}
