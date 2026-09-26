import "server-only"

/**
 * Uma coluna da ordem de paginação: o nome (ascendente) ou `{ column, ascending }`.
 */
export type PageOrderKey = string | { column: string; ascending?: boolean }

/**
 * Ordem da paginação — NÃO vazia por tipo. Tem que ser TOTAL: o conjunto das colunas
 * precisa conter uma chave única da tabela (PK ou UNIQUE real do schema), senão ela
 * não serve de desempate. Quem confere é
 * `tests/unit/orchestration/paginacao-ordem-total.test.ts`.
 */
export type PageOrder = readonly [PageOrderKey, ...PageOrderKey[]]

/**
 * O pedaço do builder do PostgREST que o helper usa. É estrutural de propósito: o
 * `PostgrestFilterBuilder` real satisfaz isto pela sobrecarga `order(column: string)`,
 * sem cast em nenhum chamador.
 */
export interface PaginableQuery {
  order(column: string, options?: { ascending?: boolean }): PaginableQuery
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

export interface PaginateOptions {
  /** Ordem TOTAL da paginação. Obrigatória — ver `PageOrder`. */
  orderBy: PageOrder
  /** Prefixo da mensagem de erro. */
  label?: string
  /** Tamanho da página (default 1000, o corte do PostgREST). */
  page?: number
}

/**
 * Aplica a ordem declarada, na sequência declarada, ANTES do `.range()`.
 *
 * 🔴 Paginação por offset sem ordem total não é paginação: o Postgres não promete a
 * mesma ordem entre duas requisições, então a mesma linha pode vir duas vezes e outra
 * sumir — sem erro, com um conjunto plausível. Medido na nuvem em 2026-09-21: 2.050
 * linhas de `category_scores` lidas em 3 páginas voltaram com 1.550 ids únicos.
 */
function orderedPage(build: () => PaginableQuery, orderBy: PageOrder, from: number, to: number) {
  let q = build()
  for (const key of orderBy) {
    const { column, ascending = true } = typeof key === "string" ? { column: key } : key
    q = q.order(column, { ascending })
  }
  return q.range(from, to)
}

function assertOrder(orderBy: PageOrder | undefined, label: string): void {
  // O tipo já exige a tupla não vazia; isto pega quem chega por `as`/`any`.
  if (!orderBy || orderBy.length === 0) {
    throw new Error(`${label}: paginação sem ordem declarada (orderBy vazio)`)
  }
}

/**
 * Lê TODAS as linhas de uma query paginando em blocos de `page` (default 1000).
 * Existe porque o PostgREST corta silenciosamente em 1000 linhas por resposta:
 * uma contagem/agregação que faz `.select(...)` sem `.range()` numa tabela que
 * passou de 1000 linhas perde linhas sem erro (foi o bug do badge "Avaliação IA"
 * × aba quando `synopsis_quality_predictions` cruzou 1000).
 *
 * O chamador entrega a query SEM `.order()` e SEM `.range()`; o helper aplica os dois.
 *
 * Uso:
 * `fetchAllRows<Row>(() => sb.from("t").select("c").eq("x", 1), { orderBy: ["id"], label: "t" })`.
 *
 * Lança em erro do PostgREST (com `label` no prefixo). Para quando um bloco volta
 * com menos que `page` linhas.
 */
export async function fetchAllRows<T>(build: () => PaginableQuery, options: PaginateOptions): Promise<T[]> {
  const { orderBy, label = "fetchAllRows", page = 1000 } = options
  assertOrder(orderBy, label)
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await orderedPage(build, orderBy, from, from + page - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const batch = (data ?? []) as T[]
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
 * (contadores de aba).
 *
 * Com a ordem total obrigatória, as páginas paralelas cobrem o conjunto sem buraco nem
 * repetição; a concatenação segue a ordem das páginas.
 *
 * Fallback: se o PostgREST não devolver `count` (null), cai pro `fetchAllRows`
 * sequencial — nunca perde linhas.
 */
export async function fetchAllRowsParallel<T>(
  countQuery: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  build: () => PaginableQuery,
  options: PaginateOptions & { concurrency?: number },
): Promise<T[]> {
  const { orderBy, label = "fetchAllRowsParallel", page = 1000, concurrency = 6 } = options
  assertOrder(orderBy, label)
  const { count, error: countErr } = await countQuery()
  if (countErr) throw new Error(`${label} (count): ${countErr.message}`)
  if (count == null) return fetchAllRows<T>(build, { orderBy, label, page })
  if (count <= 0) return []

  const pages = Math.ceil(count / page)
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < pages; i++) ranges.push([i * page, i * page + page - 1])

  const out: T[] = []
  for (let i = 0; i < ranges.length; i += concurrency) {
    const wave = ranges.slice(i, i + concurrency)
    const results = await Promise.all(
      wave.map(async ([from, to]) => {
        const { data, error } = await orderedPage(build, orderBy, from, to)
        if (error) throw new Error(`${label}: ${error.message}`)
        return (data ?? []) as T[]
      }),
    )
    for (const batch of results) out.push(...batch)
  }
  return out
}

/**
 * Roda um `.in(coluna, ids)` em LOTES de `chunkSize` ids e concatena as linhas.
 * Existe porque o PostgREST manda o filtro `.in(...)` na query string de um GET:
 * com centenas de UUIDs a URL passa de ~24KB e o gateway do Supabase responde
 * **400 "Bad Request"** (foi o bug do backfill de resumo/digest de reviews, com
 * 671 obras). Cada lote vira uma URL curta. NÃO lança — devolve o 1º erro do
 * PostgREST pra o chamador tratar (ex.: mensagem específica de migration).
 *
 * Não pagina: cada lote é UMA requisição, sem `.range()`.
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
