import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveInterestPromptVersion } from "@/lib/ai-evaluation/compiled-preferences"

/**
 * O badge da barra conta a fila de Interesse em TODA página com
 * `getSynopsisQueueWorks({ countOnly: true })`, e a contagem lia a projeção completa da fila —
 * título, capas e nota de 1.036 obras — para virar um `.length`. Medido em 2026-10-04:
 * 233 KB por carga. Agora a contagem lê só o `id`.
 *
 * O banco em memória daqui APLICA a projeção do `select` (com `select("id")` a linha volta só
 * com o id). É isso que dá dente ao teste: se o caminho de contagem dependesse de outro campo
 * da linha, a contagem mudaria em vez de passar verde com a linha inteira.
 *
 * O que fica preso:
 *   - `countOnly` devolve exatamente as mesmas obras que o caminho completo, nos argumentos dos
 *     chamadores reais (badge, "marcar tudo como lido", contagem de aba);
 *   - `countOnly` sem filtro de delta lê só `id`; o caminho normal segue com a projeção completa
 *     e com os dados que a tela usa;
 *   - com filtro de DELTA (que compara o ♥ da linha com a previsão) a projeção continua a
 *     completa, e a elegibilidade não muda.
 */

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let selects: Array<{ table: string; cols: string }>

/** Colunas de topo de um select do PostgREST: "a, b, emb(x, y)" → ["a","b","emb"]. */
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
      const orders: Array<{ c: string; asc: boolean }> = []
      const q: Record<string, unknown> = {
        select(c: string, o: { count?: string; head?: boolean } = {}) {
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
        order: (c: string, o: { ascending?: boolean } = {}) => (orders.push({ c, asc: o.ascending !== false }), q),
        range: (a: number, b: number) => ((range = [a, b]), q),
        limit: (n: number) => ((limitN = n), q),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)))
          for (const { c, asc } of [...orders].reverse()) {
            rows = [...rows].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1))
          }
          const count = rows.length
          if (range) rows = rows.slice(range[0], range[1] + 1)
          if (limitN != null) rows = rows.slice(0, limitN)
          const keys = topLevel(cols)
          const projected = keys.includes("*") ? rows : rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])))
          return Promise.resolve(head ? { data: null, error: null, count } : { data: projected, error: null, count }).then(res, rej)
        },
      }
      return q
    },
  }
}

const statusPessoal: Record<string, number | null> = {}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }))
vi.mock("@/server/queries/user-interest", () => ({ getInterestReader: async () => ({ scope: <T,>(q: T) => q }) }))
vi.mock("@/server/queries/user-work-state", async (importOriginal) => ({
  // O módulo real fornece o resto (EMPTY_PERSONAL_STATE, que a fila usa no leitor neutro).
  ...(await importOriginal<typeof import("@/server/queries/user-work-state")>()),
  getPersonalStateReader: async () => ({
    userId: "u",
    get: (id: string) => ({ personalStatusId: statusPessoal[id] ?? null, lastReadAt: null }),
  }),
}))
vi.mock("@/lib/orchestration/integrations/readiness-loader", () => ({ loadWorkReadinessSnapshots: async () => new Map() }))

const V = resolveInterestPromptVersion()
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`
const obra = (n: number, extra: Row = {}): Row => ({
  id: id(n),
  title: `Obra ${n}`,
  publication_status_id: 1,
  synopsis_quality: null,
  synopsis_quality_source: null,
  updated_at: `2026-09-${String(10 + n).padStart(2, "0")}T00:00:00Z`,
  is_archived: false,
  canonical_synopsis: "sinopse",
  synopsis_interest_skipped: false,
  work_covers: [{ url: `https://capa/${n}.jpg`, is_primary: true, position: 0 }],
  calculated_scores: { expected_score: 7 + n / 10 },
  ...extra,
})
const previsao = (n: number, wid: number, extra: Row = {}): Row => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`,
  work_id: id(wid),
  predicted_quality: "♥♥♥",
  stale: false,
  confidence: 0.8,
  prompt_version: V,
  predicted_at: "2026-09-30T00:00:00Z",
  justification: "texto longo",
  ...extra,
})

function baseDb() {
  return {
    works_owner: [
      obra(1), // não prevista
      obra(2), // prevista e fresca
      obra(3), // prevista, mas stale
      obra(4), // só previsão de versão antiga → desatualizada
      obra(5, { canonical_synopsis: null }), // fora: sem sinopse canônica
      obra(6, { is_archived: true }), // fora: arquivada
      obra(7, { synopsis_interest_skipped: true }), // fora: pulada
      obra(8, { publication_status_id: 2 }), // não prevista, outra publicação
      obra(9, { synopsis_quality: "♥♥", synopsis_quality_source: "manual" }), // delta +1 com ♥♥♥
      obra(10, { synopsis_quality: "♥♥♥", synopsis_quality_source: "prediction_applied" }), // delta não conta
      obra(11, { synopsis_quality: "♥" }), // não prevista, mas com ♥ manual
    ],
    synopsis_quality_predictions: [
      previsao(2, 2),
      previsao(3, 3, { stale: true }),
      previsao(4, 4, { prompt_version: "v0-antiga" }),
      previsao(9, 9),
      previsao(10, 10),
    ],
  }
}

async function fila(opts: Parameters<typeof import("@/server/queries/recommendations").getSynopsisQueueWorks>[0]) {
  const { getSynopsisQueueWorks } = await import("@/server/queries/recommendations")
  return getSynopsisQueueWorks(opts)
}
const ids = (ws: Array<{ id: string }>) => ws.map((w) => w.id).sort()
const scanSelects = () =>
  selects.filter((s) => s.table === "works_owner" && s.cols !== "synopsis_interest_skipped").map((s) => s.cols)

beforeEach(() => {
  db = baseDb()
  selects = []
  for (const k of Object.keys(statusPessoal)) delete statusPessoal[k]
  statusPessoal[id(1)] = 10
  statusPessoal[id(8)] = 20
})

describe("fila de Interesse: a contagem lê só o id e conta as MESMAS obras", () => {
  const argsReais = [
    { nome: "badge da barra", states: ["unpredicted"] as const },
    { nome: "marcar tudo como lido", states: ["unpredicted", "stale"] as const },
    { nome: "todos os estados", states: ["unpredicted", "stale", "predicted"] as const },
  ]

  for (const { nome, states } of argsReais) {
    it(`${nome}: countOnly devolve as mesmas obras do caminho completo, lendo só "id"`, async () => {
      const completa = await fila({ states: [...states] })
      selects = []
      const contagem = await fila({ states: [...states], countOnly: true })

      expect(ids(contagem)).toEqual(ids(completa))
      expect(contagem.length).toBeGreaterThan(0)
      expect(scanSelects()).toEqual(["id"])
    })
  }

  it("as regras de elegibilidade não mudaram: estados e exclusões, no caminho de contagem", async () => {
    const naoPrevistas = await fila({ states: ["unpredicted"], countOnly: true })
    expect(ids(naoPrevistas)).toEqual([id(1), id(8), id(11)].sort())
    const desatualizadas = await fila({ states: ["stale"], countOnly: true })
    expect(ids(desatualizadas)).toEqual([id(3), id(4)].sort())
  })

  it("filtros de publicação e de status pessoal continuam valendo no countOnly", async () => {
    const porPublicacao = await fila({ states: ["unpredicted"], pubStatusIds: [2], countOnly: true })
    expect(ids(porPublicacao)).toEqual([id(8)])
    const porStatus = await fila({ states: ["unpredicted"], personalStatusIds: [10], countOnly: true })
    expect(ids(porStatus)).toEqual([id(1)])
  })

  it("triagem manual (missingManual) + countOnly: mesmas obras e só id", async () => {
    const completa = await fila({ states: ["unpredicted"], missingManual: true })
    selects = []
    const contagem = await fila({ states: ["unpredicted"], missingManual: true, countOnly: true })
    expect(ids(contagem)).toEqual(ids(completa))
    expect(ids(contagem)).toEqual([id(1), id(2), id(3), id(4), id(8)].sort())
    expect(scanSelects()).toEqual(["id"])
  })

  it("com filtro de DELTA a projeção continua completa e o resultado é o do caminho completo", async () => {
    const args = { states: ["predicted", "stale"] as Array<"predicted" | "stale">, predictionDeltas: ["1"] }
    const completa = await fila(args)
    selects = []
    const contagem = await fila({ ...args, countOnly: true })

    expect(ids(contagem)).toEqual(ids(completa))
    expect(ids(contagem)).toEqual([id(9)]) // ♥♥ manual × ♥♥♥ previsto; a de prediction_applied não conta
    expect(scanSelects()).not.toContain("id")
    expect(scanSelects()[0]).toContain("synopsis_quality")
  })

  it("o caminho normal segue trazendo os dados completos que a tela usa", async () => {
    const lista = await fila({ states: ["unpredicted", "stale", "predicted"] })
    const w1 = lista.find((w) => w.id === id(1))!

    expect(scanSelects()[0]).toContain("work_covers(")
    expect(w1.title).toBe("Obra 1")
    expect(w1.coverUrls).toEqual(["https://capa/1.jpg"])
    expect(w1.expectedScore).toBeCloseTo(7.1)
    expect(w1.publicationStatusId).toBe(1)
    expect(lista.find((w) => w.id === id(2))?.justification).toBe("texto longo")
  })
})
