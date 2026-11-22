import { describe, it, expect, vi, beforeEach } from "vitest"
import { tasteLabelsToRestore, touchesLabelOrGate } from "@/lib/ratings/taste-label-restore"

/**
 * 🔴 Regra da Ana (22/11/2026): "não é pra acontecer de ter nota das categorias e não ter nota na obra".
 * Categorias de gosto completas + leitura liberada ⇒ a obra tem nota. Quem garante é o ESCRITOR do estado
 * de leitura (`writeReadingState`/`mirrorOwnerState`), por onde passa todo caminho que mexe em nota,
 * status ou capítulos. Banco falso COM ESTADO, como o de `versao-da-avaliacao-escritores.test.ts`.
 */
vi.mock("server-only", () => ({}))

type Row = Record<string, unknown>
const db = {
  work_edition_state: [] as Row[],
  user_work_state: [] as Row[],
  user_settings: [] as Row[],
  pilot_taste_scores: [] as Row[],
  works: [] as Row[],
}
const leituras: Record<string, number> = {}

function fakeClient() {
  return {
    from(table: keyof typeof db) {
      const filtros: Array<(r: Row) => boolean> = []
      let modo: "select" | "upsert" = "select"
      let lote: Row[] = []
      const exec = () => {
        if (modo === "upsert") {
          for (const r of lote) {
            const i = db[table].findIndex((x) => x.user_id === r.user_id && x.work_id === r.work_id)
            if (i >= 0) db[table][i] = { ...db[table][i], ...r }
            else db[table].push({ ...r })
          }
          return { data: null, error: null }
        }
        leituras[table] = (leituras[table] ?? 0) + 1
        return { data: db[table].filter((r) => filtros.every((f) => f(r))), error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), chain),
        is: (c: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) === v), chain),
        in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), chain),
        limit: () => chain,
        maybeSingle: async () => {
          const r = exec()
          return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
        },
        upsert: (rows: Row | Row[]) => {
          modo = "upsert"
          lote = Array.isArray(rows) ? rows : [rows]
          return chain
        },
        then: (ok: (v: unknown) => void, ko?: (e: unknown) => void) => {
          try {
            ok(exec())
          } catch (e) {
            ko?.(e)
          }
        },
      }
      return chain
    },
  }
}

const recalc = vi.hoisted(() => ({ markRecalcPending: vi.fn(async () => {}), scheduleUserRecalc: vi.fn() }))
vi.mock("@/lib/supabase/user", () => ({ createUserClient: async () => fakeClient() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient() }))
vi.mock("@/lib/server/predictions/label-transition", () => ({
  writeWithLabelTransitions: async ({ write }: { write: () => Promise<unknown> }) => ({ result: await write() }),
}))
vi.mock("@/lib/server/predictions/label-transition-io", () => ({ createLabelTransitionDeps: () => ({}) }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: recalc.markRecalcPending }))
vi.mock("@/server/recalc/user-recalc-schedule", () => ({ scheduleUserRecalc: recalc.scheduleUserRecalc }))
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }))
vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: async () => "dona",
  getOwnerUserId: async () => "dona",
  ensureSignedIn: async () => ({ ok: true, userId: "dona" }),
  ensurePermission: async () => ({ ok: true }),
  getHideAdultContent: async () => false,
}))

const U = "dona"
const SETE = {
  like_female_lead_score: 10,
  like_male_lead_score: 8,
  like_couple_score: 10,
  like_setting_score: 10,
  like_tone_score: 10,
  like_art_score: 10,
  like_pacing_score: 8,
}
const de = (work_id: string) => db.user_work_state.find((r) => r.user_id === U && r.work_id === work_id)

beforeEach(() => {
  vi.clearAllMocks()
  db.work_edition_state = []
  db.user_settings = [{ current_user_id: U, hide_adult_content: false }]
  db.works = [{ id: "w1", total_chapters: 100 }]
  db.pilot_taste_scores = [{ user_id: U, work_id: "w1", ...SETE }]
  // Started no cap. 5 de 100: travada — as categorias estão completas, mas a nota não vale.
  db.user_work_state = [{ user_id: U, work_id: "w1", personal_status_id: 2, chapters_read: 5, user_score: null }]
  for (const k of Object.keys(leituras)) delete leituras[k]
})

describe("a regra pura", () => {
  it("só devolve nota a obra com categorias completas E leitura liberada, agrupando por nota", () => {
    const rows = [
      { workId: "a", personalStatusId: null, chaptersRead: 50, totalChapters: 100 },
      { workId: "b", personalStatusId: null, chaptersRead: 5, totalChapters: 100 },
      { workId: "c", personalStatusId: null, chaptersRead: 50, totalChapters: 100 },
    ]
    // status null não é terminal nem Reading: decide o % lido.
    const out = tasteLabelsToRestore(rows, new Map([["a", 9.4], ["b", 9.4], ["c", null]]))
    expect([...out]).toEqual([[9.4, ["a"]]])
  })

  it("só reconfere quando a escrita mexe na nota, no status ou nos capítulos", () => {
    expect(touchesLabelOrGate({ chapters_read: 3 })).toBe(true)
    expect(touchesLabelOrGate({ personal_status_id: 1 })).toBe(true)
    expect(touchesLabelOrGate({ user_score: null })).toBe(true)
    expect(touchesLabelOrGate({ observations: "x" })).toBe(false)
  })
})

describe("o escritor garante: categorias completas + leitura liberada ⇒ nota", () => {
  it("a trava abriu (capítulo 50 de 100): a nota das categorias é gravada e o recálculo marcado", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    expect((await writeReadingState(U, ["w1"], { chapters_read: 50 })).error).toBeNull()
    expect(de("w1")?.user_score).toBe(9.4)
    expect(recalc.markRecalcPending).toHaveBeenCalledWith("restoreTasteLabels")
  })

  it("um 'Salvar' que grava nota vazia não apaga: a nota das categorias volta", async () => {
    db.user_work_state = [{ user_id: U, work_id: "w1", personal_status_id: 2, chapters_read: 50, user_score: 9.4 }]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["w1"], { user_score: null, chapters_read: 60 })
    expect(de("w1")?.user_score).toBe(9.4)
  })

  it("com a leitura travada, nada é gravado", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["w1"], { chapters_read: 10 })
    expect(de("w1")?.user_score).toBeNull()
    expect(recalc.markRecalcPending).not.toHaveBeenCalled()
  })

  it("categorias incompletas não viram nota", async () => {
    db.pilot_taste_scores = [{ user_id: U, work_id: "w1", ...SETE, like_art_score: null }]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["w1"], { chapters_read: 50 })
    expect(de("w1")?.user_score).toBeNull()
  })

  it("apagar de propósito (Remover minha nota) não ressuscita a nota", async () => {
    db.user_work_state = [{ user_id: U, work_id: "w1", personal_status_id: 2, chapters_read: 50, user_score: 9.4 }]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["w1"], { user_score: null }, { kind: "default" }, { skipTasteRestore: true })
    expect(de("w1")?.user_score).toBeNull()
  })

  it("escrita que não mexe em nota, status nem capítulos não lê as categorias", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["w1"], { observations: "x" })
    expect(leituras.pilot_taste_scores ?? 0).toBe(0)
  })

  it("o caminho sem sessão (mirrorOwnerState) tem a mesma garantia", async () => {
    const { mirrorOwnerState } = await import("@/server/queries/user-work-state")
    await mirrorOwnerState(U, ["w1"], { chapters_read: 50 })
    expect(de("w1")?.user_score).toBe(9.4)
  })
})
