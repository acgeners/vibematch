import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A avaliação gravava as reviews no modo PADRÃO (merge por fonte): apagava tudo da fonte que
// voltou e regravava só o que veio agora. Mangago (até 40 tópicos) e Comix (até 2 páginas)
// entregam uma JANELA, então cada avaliação descartava o que saiu dela — 290 reviews entre
// 27/09 e 19/10/2026. Ela passou ao modo ACUMULATIVO, que tinha três defeitos próprios, e é
// isso que este arquivo prende: nada some, nada duplica, e falha de leitura não vira "vazio".
//
// O Supabase daqui guarda ESTADO de verdade: o que se confere é o que sobra na tabela, não
// quais métodos foram chamados. Um mock que só registrasse chamadas passaria verde com o
// lote inteiro reinserido.

const hoisted = vi.hoisted(() => {
  type Row = Record<string, unknown>
  type Filter = ["eq" | "in", string, unknown]
  const db = {
    tables: new Map<string, Row[]>(),
    ops: [] as string[],
    failAccumulateRead: false,
  }
  const rowsOf = (t: string) => {
    if (!db.tables.has(t)) db.tables.set(t, [])
    return db.tables.get(t)!
  }
  const matches = (row: Row, filters: Filter[]) =>
    filters.every(([op, col, val]) => (op === "eq" ? row[col] === val : (val as unknown[]).includes(row[col])))

  function run(table: string, q: { op: string; filters: Filter[]; payload: unknown; single: boolean }) {
    const rows = rowsOf(table)
    if (q.op === "insert") {
      const list = q.payload as Row[]
      db.ops.push(`insert ${table} ${list.length}`)
      rows.push(...list.map((r) => ({ ...r })))
      return { data: null, error: null }
    }
    if (q.op === "delete") {
      const keep = rows.filter((r) => !matches(r, q.filters))
      db.ops.push(`delete ${table} ${rows.length - keep.length}`)
      db.tables.set(table, keep)
      return { data: null, error: null }
    }
    if (q.op === "update") {
      db.ops.push(`update ${table} ${JSON.stringify(q.payload)}`)
      for (const r of rows) if (matches(r, q.filters)) Object.assign(r, q.payload as Row)
      return { data: null, error: null }
    }
    // select
    const isAccumulateRead = table === "work_reviews" && q.filters.some(([op]) => op === "in")
    db.ops.push(`select ${table}${isAccumulateRead ? " (pool existente)" : ""}`)
    if (isAccumulateRead && db.failAccumulateRead) return { data: null, error: { message: "boom: leitura falhou" } }
    const found = rows.filter((r) => matches(r, q.filters)).map((r) => ({ ...r }))
    return { data: q.single ? (found[0] ?? null) : found, error: null }
  }

  function from(table: string) {
    const q = { op: "select", filters: [] as Filter[], payload: null as unknown, single: false }
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (rows: unknown) => ((q.op = "insert"), (q.payload = rows), api),
      delete: () => ((q.op = "delete"), api),
      update: (p: unknown) => ((q.op = "update"), (q.payload = p), api),
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), api),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), api),
      order: () => api,
      maybeSingle: () => ((q.single = true), api),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve().then(() => run(table, q)).then(res, rej),
    }
    return api
  }

  return {
    db,
    rowsOf,
    from,
    ensureReviewSummary: vi.fn(async () => ({ status: "skipped" })),
    ensureReviewDigest: vi.fn(async () => ({ status: "skipped" })),
    refreshArtSignalForWork: vi.fn(async () => {}),
  }
})
const { db, rowsOf, ensureReviewSummary, ensureReviewDigest } = hoisted

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: hoisted.from }) }))
vi.mock("@/lib/art/refresh", () => ({ refreshArtSignalForWork: hoisted.refreshArtSignalForWork }))
vi.mock("@/server/queries/current-user", () => ({
  getReviewSynthesisToggles: async () => ({ summaryEnabled: true, digestEnabled: true }),
}))
// Só os dois disparadores pagos viram espiões; os GATES (classify*) seguem os reais.
vi.mock("@/lib/orchestration/integrations/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestration/integrations/reviews")>()),
  ensureReviewSummary: hoisted.ensureReviewSummary,
  ensureReviewDigest: hoisted.ensureReviewDigest,
}))

import { saveWorkReviews } from "@/lib/external/persist-reviews"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import { classifyDigestReadiness, classifySummaryReadiness } from "@/lib/orchestration/integrations/reviews"
import { REVIEW_DIGEST_VERSION, packReviewSummaryMeta } from "@/lib/ai-recommendation/review-summarizer"
import { reviewsFingerprint } from "@/lib/reviews/fingerprint"
import { pgSafeText } from "@/lib/text/pg-safe-text"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"

const W = "obra-1"

const review = (source: ExternalSourceId, text: string): SourcedReview => ({
  source,
  sourceTitle: "Obra",
  matchScore: 1,
  text,
  textLength: text.length,
})
const texto = (prefixo: string, i: number) =>
  `${prefixo} ${i}: opinião com corpo suficiente pra ser uma review de verdade sobre a obra.`

/** Grava linhas como o banco as teria (texto já saneado, como `toRow` faria). */
function semear(source: ExternalSourceId, textos: string[]) {
  rowsOf("work_reviews").push(
    ...textos.map((t) => ({ work_id: W, source, text: pgSafeText(t), user_rating: null, fetched_at: "2026-10-01" })),
  )
}
const reviewsNoBanco = (source?: string) =>
  rowsOf("work_reviews").filter((r) => r.work_id === W && (!source || r.source === source))
const textosNoBanco = (source: string) => reviewsNoBanco(source).map((r) => String(r.text)).sort()
const fingerprintDoBanco = () =>
  reviewsFingerprint(
    reviewsNoBanco().map((r) => ({
      text: String(r.text),
      source: r.source as string,
      userRating: (r.user_rating as number | null) ?? null,
    })),
  )

const networkSpy = vi.fn(() => {
  throw new Error("nenhuma chamada de rede é permitida neste teste")
})

beforeEach(() => {
  db.tables.clear()
  db.ops.length = 0
  db.failAccumulateRead = false
  rowsOf("works").push({ id: W, reviews_hash: null, ai_eval_status: "done" })
  vi.clearAllMocks()
  vi.stubGlobal("fetch", networkSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe("saveWorkReviews({ accumulate: true }) — nada que já foi colhido some", () => {
  it("1. pool com 35 e coleta fresca de 21: as 35 continuam, nada é apagado", async () => {
    const todas = Array.from({ length: 35 }, (_, i) => texto("comix", i))
    semear("comix", todas)

    await saveWorkReviews(W, todas.slice(0, 21).map((t) => review("comix", t)), { accumulate: true })

    expect(reviewsNoBanco("comix")).toHaveLength(35)
    expect(db.ops.filter((o) => o.startsWith("delete"))).toEqual([])
    expect(db.ops.filter((o) => o.startsWith("insert"))).toEqual([])
  })

  it("2. coleta com reviews novas: só as novas entram", async () => {
    const antigas = Array.from({ length: 5 }, (_, i) => texto("mangago", i))
    semear("mangago", antigas)
    const novas = [texto("mangago-nova", 1), texto("mangago-nova", 2)]

    await saveWorkReviews(W, [...antigas.slice(0, 3), ...novas].map((t) => review("mangago", t)), { accumulate: true })

    expect(db.ops.filter((o) => o.startsWith("insert"))).toEqual(["insert work_reviews 2"])
    expect(textosNoBanco("mangago")).toEqual([...antigas, ...novas].sort())
  })

  it("3. coleta só com reviews já persistidas: nenhuma duplicata", async () => {
    const antigas = Array.from({ length: 4 }, (_, i) => texto("kitsu", i))
    semear("kitsu", antigas)

    await saveWorkReviews(W, antigas.map((t) => review("kitsu", `  ${t}  `)), { accumulate: true })

    expect(reviewsNoBanco("kitsu")).toHaveLength(4)
    expect(db.ops.filter((o) => o.startsWith("insert"))).toEqual([])
  })

  it("4. fonte que não voltou nesta coleta: as linhas dela ficam intactas", async () => {
    semear("mangago", Array.from({ length: 10 }, (_, i) => texto("mangago", i)))
    semear("comix", Array.from({ length: 10 }, (_, i) => texto("comix", i)))

    await saveWorkReviews(W, [review("mangago", texto("mangago", 0)), review("mangago", texto("mangago", 99))], {
      accumulate: true,
    })

    expect(reviewsNoBanco("comix")).toHaveLength(10)
    expect(reviewsNoBanco("mangago")).toHaveLength(11)
  })

  it("5. coleta totalmente vazia: no-op — nem leitura, nem exclusão, nem enriquecimento", async () => {
    semear("comix", [texto("comix", 1)])

    await saveWorkReviews(W, [], { accumulate: true })

    expect(db.ops).toEqual([])
    expect(reviewsNoBanco()).toHaveLength(1)
    expect(ensureReviewSummary).not.toHaveBeenCalled()
    expect(ensureReviewDigest).not.toHaveBeenCalled()
  })

  it("6a. reviews manuais: o save não toca a tabela delas", async () => {
    rowsOf("work_external_reviews_manual").push({ work_id: W, source: "anilist", text: "manual" })

    await saveWorkReviews(W, [review("comix", texto("comix", 1))], { accumulate: true })

    expect(db.ops.some((o) => o.includes("work_external_reviews_manual"))).toBe(false)
    expect(rowsOf("work_external_reviews_manual")).toHaveLength(1)
  })

  it("6b. fonte rejeitada: as linhas antigas dela não são apagadas, e o prompt continua sem elas", async () => {
    semear("animeplanet", [texto("ap", 1), texto("ap", 2)])

    // O lote da avaliação já chega SEM a fonte rejeitada (o contexto a filtra na coleta).
    await saveWorkReviews(W, [review("comix", texto("comix", 1))], { accumulate: true })
    expect(reviewsNoBanco("animeplanet")).toHaveLength(2)

    // E a regra do prompt segue: a mescla com o pool descarta a rejeitada.
    const persisted = [review("animeplanet", texto("ap", 1)), review("comix", texto("comix", 9))]
    const { merged } = mergeFreshWithPersistedReviews([review("comix", texto("comix", 1))], persisted, ["animeplanet"])
    expect(merged.map((r) => r.source)).toEqual(["comix", "comix"])
  })

  it("7. nenhuma chamada real: rede bloqueada e enriquecimento pago só por espião", async () => {
    await saveWorkReviews(W, [review("comix", texto("comix", 1))], { accumulate: true })
    expect(networkSpy).not.toHaveBeenCalled()
    // Mesmos disparadores do modo anterior, sem `force`: quem decide pagar é o gate.
    expect(ensureReviewSummary).toHaveBeenCalledWith(W, expect.objectContaining({ force: undefined }))
    expect(ensureReviewDigest).toHaveBeenCalledWith(W, expect.objectContaining({ force: undefined }))
  })
})

describe("os três defeitos do modo acumulativo", () => {
  it("texto cortado no meio de emoji NÃO é reinserido (a chave compara o texto GRAVADO)", async () => {
    // O conector corta em 900: "😀" é um par de surrogates, e o corte deixa só a metade alta.
    const cru = `${"a".repeat(899)}${"😀".slice(0, 1)}`
    expect(pgSafeText(cru)).not.toBe(cru) // senão o caso não exercita nada
    semear("comix", [cru]) // o banco guarda a versão saneada (899 caracteres)

    await saveWorkReviews(W, [review("comix", cru)], { accumulate: true })
    await saveWorkReviews(W, [review("comix", cru)], { accumulate: true })

    expect(reviewsNoBanco("comix")).toHaveLength(1)
    expect(db.ops.filter((o) => o.startsWith("insert"))).toEqual([])
  })

  it("erro na leitura do pool existente interrompe: nada é inserido, nada é recalculado", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    semear("mangago", [texto("mangago", 1), texto("mangago", 2)])
    db.failAccumulateRead = true

    await saveWorkReviews(W, [review("mangago", texto("mangago", 1)), review("mangago", texto("mangago", 2))], {
      accumulate: true,
    })

    expect(reviewsNoBanco("mangago")).toHaveLength(2)
    expect(db.ops.filter((o) => o.startsWith("insert") || o.startsWith("update"))).toEqual([])
    expect(ensureReviewSummary).not.toHaveBeenCalled()
    expect(ensureReviewDigest).not.toHaveBeenCalled()
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/erro lendo o pool existente/)
    errSpy.mockRestore()
  })

  it("duplicata DENTRO do mesmo lote entra uma vez só", async () => {
    const t = texto("mangadex", 7)

    await saveWorkReviews(W, [review("mangadex", t), review("mangadex", t), review("mangadex", ` ${t}`)], {
      accumulate: true,
    })

    expect(db.ops.filter((o) => o.startsWith("insert"))).toEqual(["insert work_reviews 1"])
    expect(reviewsNoBanco("mangadex")).toHaveLength(1)
  })

  it("reviews DIFERENTES continuam distintas (sem normalização além de trim + saneamento)", async () => {
    await saveWorkReviews(
      W,
      [
        review("mangago", "Great story, loved the leads and the pacing."),
        review("mangago", "great story, loved the leads and the pacing!"),
        review("comix", "Great story, loved the leads and the pacing."),
      ],
      { accumulate: true },
    )

    expect(reviewsNoBanco()).toHaveLength(3)
  })
})

describe("coleta só com reviews já persistidas não abre caminho para chamada paga", () => {
  it("o pool não muda ⇒ fingerprint igual, nenhum `update` e nenhum `force`", async () => {
    const antigas = Array.from({ length: 6 }, (_, i) => texto("comix", i))
    semear("comix", antigas)
    rowsOf("works")[0].reviews_hash = fingerprintDoBanco()

    await saveWorkReviews(W, antigas.map((t) => review("comix", t)), { accumulate: true })

    expect(db.ops.filter((o) => /^(insert|delete|update)/.test(o))).toEqual([])
    expect(rowsOf("works")[0]).not.toHaveProperty("ai_eval_reviews_stale")
    expect(ensureReviewSummary).toHaveBeenCalledWith(W, expect.objectContaining({ force: undefined }))
    expect(ensureReviewDigest).toHaveBeenCalledWith(W, expect.objectContaining({ force: undefined }))
  })

  it("e com o mesmo conteúdo os gates REAIS de resumo e digest não pedem regeneração", () => {
    expect(
      classifySummaryReadiness({
        reviewCount: 6,
        currentHash: "h1",
        nowN: 6,
        storedSummary: "resumo",
        storedMeta: packReviewSummaryMeta("h1", 6),
      }).state,
    ).toBe("fresh")
    expect(
      classifyDigestReadiness({
        reviewCount: 6,
        nowN: 6,
        storedDigest: { traits: [] },
        storedVersion: REVIEW_DIGEST_VERSION,
        storedN: 6,
      }).state,
    ).toBe("fresh")
  })

  it("review realmente nova muda o fingerprint e marca a avaliação como desatualizada (como antes)", async () => {
    semear("comix", [texto("comix", 1)])
    rowsOf("works")[0].reviews_hash = fingerprintDoBanco()

    await saveWorkReviews(W, [review("comix", texto("comix", 2))], { accumulate: true })

    expect(rowsOf("works")[0].reviews_hash).toBe(fingerprintDoBanco())
    expect(rowsOf("works")[0].ai_eval_reviews_stale).toBe(true)
  })
})

describe("os outros modos de saveWorkReviews seguem como estavam", () => {
  it("padrão (merge por fonte): substitui só as fontes do lote", async () => {
    semear("comix", [texto("comix", 1), texto("comix", 2), texto("comix", 3)])
    semear("mangago", [texto("mangago", 1), texto("mangago", 2)])

    await saveWorkReviews(W, [review("comix", texto("comix", 9))])

    expect(textosNoBanco("comix")).toEqual([texto("comix", 9)])
    expect(reviewsNoBanco("mangago")).toHaveLength(2)
  })

  it("replace: true apaga o snapshot inteiro e grava o lote", async () => {
    semear("comix", [texto("comix", 1)])
    semear("mangago", [texto("mangago", 1)])

    await saveWorkReviews(W, [review("kitsu", texto("kitsu", 1))], { replace: true })

    expect(reviewsNoBanco().map((r) => r.source)).toEqual(["kitsu"])
  })

  it("replace: true com lote vazio limpa as reviews e o resumo", async () => {
    semear("comix", [texto("comix", 1)])

    await saveWorkReviews(W, [], { replace: true })

    expect(reviewsNoBanco()).toEqual([])
    expect(rowsOf("works")[0].review_summary).toBeNull()
  })

  it("`replace` vence `accumulate` (destrutivo só quando pedido explicitamente)", async () => {
    semear("comix", [texto("comix", 1), texto("comix", 2)])

    await saveWorkReviews(W, [review("comix", texto("comix", 3))], { replace: true, accumulate: true })

    expect(textosNoBanco("comix")).toEqual([texto("comix", 3)])
  })
})

describe("a avaliação IA grava em modo acumulativo", () => {
  // `triggerAiEvaluation` não tem harness executável (o projeto confere a action pelo
  // source, ver arte-canonica.test.ts). O fato conferido: TODA chamada a `saveWorkReviews`
  // dentro da action leva `accumulate: true` e nenhuma pede `replace`.
  const src = readFileSync("server/actions/ai.ts", "utf8")
  const ini = src.indexOf("export async function triggerAiEvaluation")
  const corpo = src.slice(ini, src.indexOf("\nexport async function", ini + 10))
  const chamadas = [...corpo.matchAll(/saveWorkReviews\(([^)]*)\)/g)].map((m) => m[1])

  it("há pelo menos uma chamada (senão o teste não está olhando nada)", () => {
    expect(chamadas.length).toBeGreaterThan(0)
  })

  it("todas pedem accumulate: true e nenhuma pede replace", () => {
    for (const args of chamadas) {
      expect(args).toMatch(/accumulate:\s*true/)
      expect(args).not.toMatch(/replace/)
    }
  })
})
