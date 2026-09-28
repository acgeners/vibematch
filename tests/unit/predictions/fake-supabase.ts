/**
 * Supabase EM MEMÓRIA, só o que os escritores de nota e o ledger usam: select/eq/in/is/not,
 * upsert (onConflict + ignoreDuplicates), update (com count) e maybeSingle/single.
 *
 * Existe para testar COMPORTAMENTO (ordem, idempotência, o que fica gravado) — um mock de chamadas
 * passaria verde com a captura lendo a previsão DEPOIS da nota, que é o defeito que importa.
 */
export type Row = Record<string, unknown>
export type Db = Record<string, Row[]>

export interface FakeOptions {
  /** Chave única por tabela (a do `onConflict`). */
  unique?: Record<string, string[]>
  /** Chamado depois de cada upsert bem-sucedido — simula efeitos (ex.: um recálculo). */
  afterUpsert?: (table: string, rows: Row[]) => void
  /** Erro forçado por tabela/operação. */
  failOn?: (table: string, op: "select" | "upsert" | "update", payload?: unknown) => { code?: string; message: string } | null
  /** Registro de TODA operação, em ordem. */
  log?: string[]
}

type Filter = (r: Row) => boolean

export function fakeSupabase(db: Db, opts: FakeOptions = {}) {
  const log = opts.log ?? []
  function builder(table: string) {
    const filters: Filter[] = []
    let op: "select" | "upsert" | "update" = "select"
    let payload: unknown = null
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    let single: "single" | "maybe" | null = null
    let countMode = false
    let headMode = false
    let limitN: number | null = null
    const q: Record<string, unknown> = {
      select: (_cols?: string, o: { count?: string; head?: boolean } = {}) => {
        if (o.count === "exact") countMode = true
        if (o.head) headMode = true
        return q
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      not: (c: string, operator: string, v: unknown) =>
        (filters.push((r) => (operator === "is" && v === null ? r[c] != null : r[c] !== v)), q),
      order: () => q,
      limit: (n: number) => ((limitN = n), q),
      maybeSingle: () => ((single = "maybe"), q),
      single: () => ((single = "single"), q),
      upsert: (rows: Row | Row[], o: typeof upsertOpts = {}) => {
        op = "upsert"
        payload = Array.isArray(rows) ? rows : [rows]
        upsertOpts = o
        return q
      },
      update: (values: Row, o: { count?: string } = {}) => {
        op = "update"
        payload = values
        countMode = o.count === "exact"
        return q
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    function run(): { data: unknown; error: unknown; count?: number } {
      log.push(`${op}:${table}`)
      const forced = opts.failOn?.(table, op, payload)
      if (forced) return { data: null, error: forced }
      db[table] ??= []
      const rows = db[table]
      if (op === "select") {
        let out = rows.filter((r) => filters.every((f) => f(r)))
        if (limitN != null) out = out.slice(0, limitN)
        if (single) return { data: out[0] ?? null, error: null }
        if (headMode) return { data: null, error: null, count: out.length }
        return { data: out.map((r) => ({ ...r })), error: null, count: countMode ? out.length : undefined }
      }
      if (op === "upsert") {
        const key = (upsertOpts.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        const uniq = key.length ? key : opts.unique?.[table] ?? []
        const written: Row[] = []
        for (const incoming of payload as Row[]) {
          const idx = uniq.length ? rows.findIndex((r) => uniq.every((k) => r[k] === incoming[k])) : -1
          if (idx >= 0) {
            if (upsertOpts.ignoreDuplicates) continue
            rows[idx] = { ...rows[idx], ...incoming }
            written.push(rows[idx])
          } else {
            const r = { ...incoming }
            rows.push(r)
            written.push(r)
          }
        }
        opts.afterUpsert?.(table, written)
        return { data: null, error: null }
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)))
      for (const r of hit) Object.assign(r, payload as Row)
      return { data: null, error: null, count: countMode ? hit.length : undefined }
    }
    return q
  }
  return { from: (t: string) => builder(t), log }
}
