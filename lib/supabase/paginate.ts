import "server-only"

/**
 * Lê TODAS as linhas de uma query paginando em blocos de `page` (default 1000).
 * Existe porque o PostgREST corta silenciosamente em 1000 linhas por resposta:
 * uma contagem/agregação que faz `.select(...)` sem `.range()` numa tabela que
 * passou de 1000 linhas perde linhas sem erro (foi o bug do badge "Avaliação IA"
 * × aba quando `synopsis_quality_predictions` cruzou 1000).
 *
 * Uso: `fetchAllRows((from, to) => sb.from("t").select("c").range(from, to))`.
 * Lança em erro do PostgREST (com `label` no prefixo). Para quando um bloco volta
 * com menos que `page` linhas.
 */
export async function fetchAllRows<T>(
  makeRangeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label = "fetchAllRows",
  page = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await makeRangeQuery(from, from + page - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < page) break
  }
  return out
}
