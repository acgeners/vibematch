/**
 * Paginação de `select` do Supabase para scripts de diagnóstico.
 *
 * O `select` do PostgREST devolve no MÁXIMO 1000 linhas por padrão, sem erro e
 * sem aviso — a query "funciona" e você trabalha com um recorte achando que é o
 * universo (ver CLAUDE.md). Este helper pagina até o fim.
 *
 * A armadilha que ele existe pra matar: quando o tamanho de página e a condição
 * de parada moram em dois lugares, baixar o `range` de 1000 pra 200 (pra fugir do
 * statement timeout ao ler colunas gordas como `raw_response`) sem ajustar o
 * `if (data.length < 1000) break` faz o loop parar na PRIMEIRA página. Você lê 200
 * de 2.296 linhas e nada indica que faltou algo. Aqui o `break` deriva do mesmo
 * `pageSize` que monta o `range`, então é impossível dessincronizar os dois.
 *
 * Sempre confira o total contra `count: "exact"` antes de confiar no resultado:
 *   const { count } = await sb.from("t").select("*", { count: "exact", head: true })
 */
export interface PageAllOptions {
  /** Linhas por requisição. Baixe (200, 100) ao selecionar colunas grandes —
   *  `raw_response` de 1000 avaliações estoura o statement timeout. */
  pageSize?: number
  /** Teto de segurança de páginas, pra um bug de cursor não virar loop infinito. */
  maxPages?: number
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/**
 * @param build recebe os índices INCLUSIVOS de `range(from, to)` e devolve a query.
 */
export async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: PageAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000
  const maxPages = options.maxPages ?? 10_000
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`pageAll: pageSize inválido (${pageSize})`)
  }

  const out: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new Error(`pageAll: ${error.message} (página ${page}, from ${from})`)
    if (!data?.length) return out
    out.push(...data)
    // Página incompleta = última página. Derivado de `pageSize`, nunca de um
    // literal — é exatamente esse acoplamento que evita a leitura truncada.
    if (data.length < pageSize) return out
  }
  throw new Error(`pageAll: passou de ${maxPages} páginas — cursor provavelmente travado`)
}
