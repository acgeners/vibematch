import { describe, it, expect, vi, beforeEach } from "vitest"

/** A nota de obra arquivada não treina a Nota Prevista (`fetchRecalcWorks`), então não entra na lista nem no ensō. */
vi.mock("server-only", () => ({}))

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
function fakeClient() {
  return {
    from(table: string) {
      const filtros: Array<(r: Row) => boolean> = []
      const val = (r: Row, c: string) => c.split(".").reduce<unknown>((o, k) => (o as Row | undefined)?.[k], r)
      const run = () => ({ data: (db[table] ?? []).filter((r) => filtros.every((f) => f(r))), error: null })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filtros.push((r) => val(r, c) === v), chain),
        is: (c: string, v: unknown) => (filtros.push((r) => (val(r, c) ?? null) === v), chain),
        not: (c: string, _op: string, v: unknown) => (filtros.push((r) => (val(r, c) ?? null) !== v), chain),
        in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(val(r, c))), chain),
        order: () => chain,
        limit: () => chain,
        range: () => chain,
        then: (ok: (v: unknown) => void) => {
          const r = run()
          ok({ ...r, count: r.data.length })
        },
      }
      return chain
    },
  }
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient() }))
vi.mock("@/server/queries/onboarding-deck", () => ({
  hydrateOnboardingWorks: async (ids: string[]) => ids.map((id) => ({ id, title: id, totalChapters: 100 })),
}))

const U = "u1"
// Finished (terminal, sempre liberada), pelo id que o app usa.
const { getPersonalStatusIdByName } = await import("@/lib/constants/status-lookups")
const FINISHED = getPersonalStatusIdByName("Finished")
const linha = (id: string, score: number | null, arquivada: boolean): Row => ({
  user_id: U,
  work_id: id,
  user_score: score,
  personal_status_id: FINISHED,
  chapters_read: 100,
  updated_at: "2026-11-22T00:00:00Z",
  works: { is_archived: arquivada },
})

beforeEach(() => {
  db.user_work_state = [
    linha("ativa-sem", null, false),
    linha("arq-sem", null, true),
    linha("ativa-com", 8, false),
    linha("arq-com", 9, true),
  ]
  db.works = [
    { id: "ativa-sem", total_chapters: 100, is_archived: false },
    { id: "arq-sem", total_chapters: 100, is_archived: true },
  ]
})

describe("obra arquivada fica fora da tela de notas", () => {
  it("da lista", async () => {
    const { getUnratedRead } = await import("@/server/queries/onboarding-imported")
    expect((await getUnratedRead(U)).map((w) => w.id)).toEqual(["ativa-sem"])
  })
  it("do número de notas do ensō", async () => {
    const { countRatedWorksOf } = await import("@/server/queries/onboarding-imported")
    expect(await countRatedWorksOf(U)).toBe(1)
  })
  it("do 'de M obras'", async () => {
    const { countUnratedReadSplitOf } = await import("@/server/queries/onboarding-imported")
    expect(await countUnratedReadSplitOf(U)).toEqual({ rateable: 1, locked: 0 })
  })
})
