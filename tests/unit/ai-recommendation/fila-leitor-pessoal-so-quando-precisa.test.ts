import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveInterestPromptVersion } from "@/lib/ai-evaluation/compiled-preferences"

/**
 * As duas filas da barra (Veredito e Interesse) carregavam `user_work_state` INTEIRA mesmo no
 * modo contagem sem filtro de status pessoal — em que o estado não decide nada. Medido em
 * 2026-10-04: a action da barra fazia 2 leituras completas por carga logada (~54 KB cada).
 *
 * O leitor pessoal mockado aqui LÊ a tabela `user_work_state` do banco em memória, então o que
 * fica preso é o fato — "a tabela foi lida ou não" — e não só "a função foi chamada":
 *   - countOnly SEM filtro pessoal: não lê `user_work_state` e conta exatamente as mesmas obras;
 *   - countOnly COM filtro pessoal: continua lendo e filtrando certo;
 *   - caminho normal: continua lendo e preenchendo o status pessoal de cada obra;
 * nas DUAS filas.
 */

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let selects: Array<{ table: string; cols: string }>

function topLevel(cols: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of cols) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.split("(")[0].trim()).filter(Boolean)
}

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let cols = "*"
      let head = false
      let range: [number, number] | null = null
      let limitN: number | null = null
      const q: Record<string, unknown> = {
        select(c: string, o: { head?: boolean } = {}) {
          cols = c
          head = Boolean(o.head)
          selects.push({ table, cols: c })
          return q
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
        not: (c: string, op: string, v: unknown) => (filters.push((r) => !(op === "is" && v === null ? r[c] == null : r[c] === v)), q),
        order: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        limit: (n: number) => ((limitN = n), q),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)))
          const count = rows.length
          if (range) rows = rows.slice(range[0], range[1] + 1)
          if (limitN != null) rows = rows.slice(0, limitN)
          const keys = topLevel(cols)
          const data = keys.includes("*") ? rows : rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])))
          return Promise.resolve(head ? { data: null, error: null, count } : { data, error: null, count }).then(res, rej)
        },
      }
      return q
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }))
vi.mock("@/server/queries/user-interest", () => ({ getInterestReader: async () => ({ scope: <T,>(q: T) => q }) }))
vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({ overlay: (_id: string, row: unknown) => row }),
}))
vi.mock("@/lib/orchestration/integrations/readiness-loader", () => ({ loadWorkReadinessSnapshots: async () => new Map() }))
vi.mock("@/server/queries/user-work-state", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/queries/user-work-state")>()
  return {
    ...real,
    // O leitor de verdade lê a tabela da pessoa; este também — é a leitura que o teste vigia.
    getPersonalStateReader: async () => {
      type Consulta = { select(c: string): Consulta; eq(c: string, v: unknown): Consulta } & PromiseLike<{
        data: Array<{ work_id: string; personal_status_id: number | null }>
      }>
      const { data } = await (fakeDb().from("user_work_state") as unknown as Consulta)
        .select("work_id, personal_status_id")
        .eq("user_id", "u")
      const porObra = new Map(data.map((r) => [r.work_id, r.personal_status_id]))
      return {
        userId: "u",
        get: (id: string) => ({ ...real.EMPTY_PERSONAL_STATE, personalStatusId: porObra.get(id) ?? null }),
      }
    },
  }
})

const V = resolveInterestPromptVersion()
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`
const obra = (n: number, calc: Row, extra: Row = {}): Row => ({
  id: id(n),
  title: `Obra ${n}`,
  publication_status_id: 1,
  synopsis_quality: null,
  synopsis_quality_source: null,
  updated_at: `2026-09-${String(10 + n).padStart(2, "0")}T00:00:00Z`,
  is_archived: false,
  ai_eval_status: "done",
  canonical_synopsis: "sinopse",
  synopsis_interest_skipped: false,
  work_covers: [],
  calculated_scores: { expected_score: 7, alignment_at: null, ...calc },
  ...extra,
})

function baseDb() {
  return {
    works_owner: [
      obra(1, { alignment_score: 80, alignment_stale: true }), // Veredito stale; Interesse não prevista
      obra(2, { alignment_score: null, alignment_stale: false }), // Veredito não rankeada; Interesse prevista
      obra(3, { alignment_score: 60, alignment_stale: false }), // Veredito em dia; Interesse não prevista
      obra(4, { alignment_score: 70, alignment_stale: true }), // Veredito stale; Interesse não prevista
      obra(5, { alignment_score: null, alignment_stale: false }, { ai_eval_status: "skipped" }), // fora do Veredito
    ],
    synopsis_quality_predictions: [
      { id: "p2", work_id: id(2), predicted_quality: "♥♥", stale: false, confidence: 0.7, prompt_version: V, predicted_at: "2026-09-01T00:00:00Z" },
    ],
    user_work_state: [
      { user_id: "u", work_id: id(1), personal_status_id: 10 },
      { user_id: "u", work_id: id(2), personal_status_id: 20 },
      { user_id: "u", work_id: id(4), personal_status_id: 20 },
    ],
  }
}

async function filas() {
  return import("@/server/queries/recommendations")
}
const ids = (ws: Array<{ id: string }>) => ws.map((w) => w.id).sort()
const leuEstadoPessoal = () => selects.some((s) => s.table === "user_work_state")

beforeEach(() => {
  db = baseDb()
  selects = []
})

describe("fila de Veredito (getAlignmentQueueWorks): estado pessoal só quando decide", () => {
  it("countOnly SEM filtro pessoal: não lê user_work_state e conta as mesmas obras do caminho completo", async () => {
    const { getAlignmentQueueWorks } = await filas()
    const completa = await getAlignmentQueueWorks({ states: ["stale", "unranked"] })
    selects = []
    const contagem = await getAlignmentQueueWorks({ states: ["stale", "unranked"], countOnly: true })

    expect(ids(contagem)).toEqual(ids(completa))
    expect(ids(contagem)).toEqual([id(1), id(2), id(4)].sort())
    expect(leuEstadoPessoal()).toBe(false)
  })

  it("countOnly COM filtro pessoal: continua lendo user_work_state e filtrando", async () => {
    const { getAlignmentQueueWorks } = await filas()
    const contagem = await getAlignmentQueueWorks({ states: ["stale", "unranked"], personalStatusIds: [20], countOnly: true })

    expect(leuEstadoPessoal()).toBe(true)
    expect(ids(contagem)).toEqual([id(2), id(4)].sort())
  })

  it("caminho normal: continua lendo e preenchendo o status pessoal de cada obra", async () => {
    const { getAlignmentQueueWorks } = await filas()
    const lista = await getAlignmentQueueWorks({ states: ["stale"] })

    expect(leuEstadoPessoal()).toBe(true)
    expect(lista.find((w) => w.id === id(1))?.personalStatusId).toBe(10)
    expect(lista.find((w) => w.id === id(4))?.personalStatusId).toBe(20)
  })
})

describe("fila de Interesse (getSynopsisQueueWorks): estado pessoal só quando decide", () => {
  it("countOnly SEM filtro pessoal: não lê user_work_state e conta as mesmas obras do caminho completo", async () => {
    const { getSynopsisQueueWorks } = await filas()
    const completa = await getSynopsisQueueWorks({ states: ["unpredicted"] })
    selects = []
    const contagem = await getSynopsisQueueWorks({ states: ["unpredicted"], countOnly: true })

    expect(ids(contagem)).toEqual(ids(completa))
    expect(ids(contagem)).toEqual([id(1), id(3), id(4), id(5)].sort())
    expect(leuEstadoPessoal()).toBe(false)
  })

  it("triagem manual + countOnly sem filtro pessoal também não lê user_work_state", async () => {
    const { getSynopsisQueueWorks } = await filas()
    const contagem = await getSynopsisQueueWorks({ states: ["unpredicted"], missingManual: true, countOnly: true })

    expect(contagem.length).toBe(5)
    expect(leuEstadoPessoal()).toBe(false)
  })

  it("countOnly COM filtro pessoal: continua lendo user_work_state e filtrando", async () => {
    const { getSynopsisQueueWorks } = await filas()
    const contagem = await getSynopsisQueueWorks({ states: ["unpredicted"], personalStatusIds: [20], countOnly: true })

    expect(leuEstadoPessoal()).toBe(true)
    expect(ids(contagem)).toEqual([id(4)])
  })

  it("caminho normal: continua lendo e preenchendo o status pessoal de cada obra", async () => {
    const { getSynopsisQueueWorks } = await filas()
    const lista = await getSynopsisQueueWorks({ states: ["unpredicted"] })

    expect(leuEstadoPessoal()).toBe(true)
    expect(lista.find((w) => w.id === id(1))?.personalStatusId).toBe(10)
    expect(lista.find((w) => w.id === id(3))?.personalStatusId).toBeNull()
  })
})
