// Banco EM MEMÓRIA para os testes do pipeline de tags e do gate 18+. Implementa só o subconjunto do
// query builder do supabase-js que esse código usa. Método que não existe aqui estoura (TypeError ou o
// Proxy do client), em vez de devolver vazio calado — fake que engole chamada passa pelo motivo errado.
import { randomUUID } from "node:crypto"

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean

const DEFAULTS: Record<string, Row> = {
  tags: {
    tag_group_id: null, tag_subgroup_id: null, adult_indicator: false, adult_indicator_strong: false,
    origin: "manual", reviewed_at: null, adult_score_tier: null, adult_score_tier_reviewed_at: null,
    marks_r19_edition: false, enrichment_status: "pending", enrichment_at: null, enrichment_detail: null,
  },
  works: { adult_auto: false, adult_reason: null, adult_override: null },
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  log: Array<{ table: string; op: string; payload?: unknown }> = []
  rows(t: string): Row[] {
    return (this.tables[t] ??= [])
  }
  client() {
    const q = (t: string) => new Q(this, t)
    return new Proxy({ from: q } as Record<string, unknown>, {
      get(target, prop) {
        if (prop in target) return target[prop as string]
        if (prop === "then") return undefined
        throw new Error(`fake-supabase: client.${String(prop)} não implementado`)
      },
    })
  }
}

function parseEmbeds(cols: string | undefined): Array<{ rel: string; fields: string[] }> {
  if (!cols) return []
  const out: Array<{ rel: string; fields: string[] }> = []
  for (const m of cols.matchAll(/(\w+)\(([^)]*)\)/g)) out.push({ rel: m[1], fields: m[2].split(",").map((s) => s.trim()) })
  return out
}

class Q {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
  private filters: Filter[] = []
  private cols?: string
  private returning = false
  private payload: unknown
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private mode: "many" | "single" | "maybe" = "many"
  private rangeArg?: [number, number]
  private limitN?: number
  constructor(private db: FakeDb, private table: string) {}

  select(cols?: string) {
    if (this.op === "select") this.cols = cols
    else this.returning = true
    return this
  }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this }
  gte(c: string, v: number) { this.filters.push((r) => Number(r[c]) >= v); return this }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  contains(c: string, arr: unknown[]) { this.filters.push((r) => arr.every((x) => (r[c] as unknown[] | undefined)?.includes(x))); return this }
  order() { return this }
  range(a: number, b: number) { this.rangeArg = [a, b]; return this }
  limit(n: number) { this.limitN = n; return this }
  maybeSingle() { this.mode = "maybe"; return this }
  single() { this.mode = "single"; return this }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = rows; this.opts = opts; return this }
  update(obj: Row) { this.op = "update"; this.payload = obj; return this }
  delete() { this.op = "delete"; return this }

  then<T>(res: (v: { data: unknown; error: null }) => T, rej?: (e: unknown) => T) {
    try {
      return Promise.resolve(res(this.exec()))
    } catch (e) {
      return rej ? Promise.resolve(rej(e)) : Promise.reject(e)
    }
  }

  private match(r: Row) { return this.filters.every((f) => f(r)) }

  private newRow(r: Row): Row {
    return { id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[this.table] ?? {}), ...r }
  }

  private exec(): { data: unknown; error: null } {
    const t = this.db.rows(this.table)
    this.db.log.push({ table: this.table, op: this.op, payload: this.payload })
    if (this.op === "select") {
      let out = t.filter((r) => this.match(r)).map((r) => ({ ...r }))
      for (const e of parseEmbeds(this.cols)) {
        for (const r of out) {
          const fk = `${e.rel.replace(/s$/, "")}_id`
          const target = this.db.rows(e.rel).find((x) => x.id === r[fk])
          r[e.rel] = target ? Object.fromEntries(e.fields.map((f) => [f, target[f]])) : null
        }
      }
      if (this.rangeArg) out = out.slice(this.rangeArg[0], this.rangeArg[1] + 1)
      if (this.limitN !== undefined) out = out.slice(0, this.limitN)
      if (this.mode !== "many") return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }
    if (this.op === "update") {
      const hit = t.filter((r) => this.match(r))
      for (const r of hit) Object.assign(r, this.payload as Row)
      return { data: this.returning ? hit : null, error: null }
    }
    if (this.op === "delete") {
      const keep = t.filter((r) => !this.match(r))
      this.db.tables[this.table] = keep
      return { data: null, error: null }
    }
    const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
    const keys = (this.opts.onConflict ?? "id").split(",").map((s) => s.trim())
    const affected: Row[] = []
    for (const r of rows) {
      const existing = this.op === "upsert" ? t.find((x) => keys.every((k) => x[k] === r[k])) : undefined
      if (existing) {
        if (this.opts.ignoreDuplicates) continue
        Object.assign(existing, r)
        affected.push(existing)
      } else {
        const n = this.newRow(r)
        t.push(n)
        affected.push(n)
      }
    }
    const data = this.returning ? (this.mode === "many" ? affected : affected[0] ?? null) : null
    return { data, error: null }
  }
}
