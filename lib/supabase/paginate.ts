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

/**
 * Versão PARALELA de `fetchAllRows`: pega a contagem exata primeiro (1 HEAD
 * request) e dispara todas as páginas de `page` linhas em paralelo (com teto de
 * `concurrency`), em vez de encadear `ceil(total/page)` round-trips em série.
 *
 * Ganho: numa tabela grande (ex.: `work_tags` ~28k linhas), o modo sequencial faz
 * ~28 round-trips em série (~8s a ~300ms/trip contra o DB de Ohio); em paralelo
 * vira ~1 (contagem) + poucas ondas ≈ ~1s. Use nos full-scans do caminho quente
 * (contadores de aba). A ordem das linhas NÃO é garantida entre páginas — use só
 * quando a agregação for order-independent (contagem/soma/max por chave).
 *
 * Fallback: se o PostgREST não devolver `count` (null), cai pro `fetchAllRows`
 * sequencial — nunca perde linhas.
 */
/**
 * Roda um `.in(coluna, ids)` em LOTES de `chunkSize` ids e concatena as linhas.
 * Existe porque o PostgREST manda o filtro `.in(...)` na query string de um GET:
 * com centenas de UUIDs a URL passa de ~24KB e o gateway do Supabase responde
 * **400 "Bad Request"** (foi o bug do backfill de resumo/digest de reviews, com
 * 671 obras). Cada lote vira uma URL curta. NÃO lança — devolve o 1º erro do
 * PostgREST pra o chamador tratar (ex.: mensagem específica de migration).
 *
 * Uso: `selectByIdsInChunks(ids, (chunk) => sb.from("works").select("id").in("id", chunk))`.
 */
export async function selectByIdsInChunks<T>(
  ids: string[],
  makeChunkQuery: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 100,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await makeChunkQuery(ids.slice(i, i + chunkSize))
    if (error) return { data: out, error }
    out.push(...(data ?? []))
  }
  return { data: out, error: null }
}

export async function fetchAllRowsParallel<T>(
  countQuery: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  makeRangeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label = "fetchAllRowsParallel",
  page = 1000,
  concurrency = 6,
): Promise<T[]> {
  const { count, error: countErr } = await countQuery()
  if (countErr) throw new Error(`${label} (count): ${countErr.message}`)
  if (count == null) return fetchAllRows(makeRangeQuery, label, page)
  if (count <= 0) return []

  const pages = Math.ceil(count / page)
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < pages; i++) ranges.push([i * page, i * page + page - 1])

  const out: T[] = []
  for (let i = 0; i < ranges.length; i += concurrency) {
    const wave = ranges.slice(i, i + concurrency)
    const results = await Promise.all(
      wave.map(async ([from, to]) => {
        const { data, error } = await makeRangeQuery(from, to)
        if (error) throw new Error(`${label}: ${error.message}`)
        return data ?? []
      }),
    )
    for (const batch of results) out.push(...batch)
  }
  return out
}
