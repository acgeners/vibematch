"use server"

import { getWorkSuggestions, type WorkSuggestion } from "@/server/queries/work-suggestions"

/**
 * Mínimo de caracteres pra disparar a busca. Com 1 letra o resultado é grande
 * demais pra ser útil e cara toda tecla no índice à toa.
 */
const MIN_QUERY_LENGTH = 2

/**
 * Sugestões pro dropdown de busca ao vivo de /titles.
 *
 * ⚠️ `"use server"` = endpoint HTTP público (chamável por POST direto). Isto aqui
 * é leitura do CATÁLOGO, que é compartilhado por design — não leva `ensureAdmin`.
 * O que é per-usuário (a preferência "ocultar 18+") é resolvido lá dentro, a
 * partir da sessão, nunca por argumento.
 */
export async function searchWorkSuggestions(query: string): Promise<WorkSuggestion[]> {
  const trimmed = (query ?? "").trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []
  return getWorkSuggestions(trimmed)
}
