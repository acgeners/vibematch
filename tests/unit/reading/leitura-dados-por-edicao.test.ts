import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const fromWorks = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fromWorks }) }))

const personal = new Map<string, Record<string, unknown>>()
vi.mock("@/server/queries/user-work-state", () => ({
  getPersonalStateReader: async () => ({ userId: "u1", get: (id: string) => personal.get(id) ?? {} }),
  resolvePersonalFilterIds: async () => ["simples", "mixed"],
}))
vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({ overlay: (_id: string, row: unknown) => row }),
}))

const editionRows = [
  { work_id: "mixed", edition: "normal", criterion_slug: "adult_content", score: null, source: "not_rated", status: "not_rated" },
  { work_id: "mixed", edition: "r18", criterion_slug: "adult_content", score: 9.5, source: "reused_existing", status: "rated" },
]
const fetchEditionScoresFor = vi.fn(async () => editionRows)
vi.mock("@/server/queries/edition-scores", () => ({
  fetchEditionScoresFor: (...args: unknown[]) => (fetchEditionScoresFor as (...a: unknown[]) => unknown)(...args),
  getMixedEditionSettings: async () => ({ hideAdult: false, signedIn: true }),
  getR18ExtrasWorkIds: async () => new Set<string>(),
}))

import { getReadingWorks } from "@/server/queries/reading"

const linhas = [
  {
    id: "simples",
    title: "Simples",
    is_adult: false,
    edition_state: null,
    calculated_scores: { expected_score: 8.2, alignment_score: "64", scoring_contract: "s9-fantasy-b-edicao-v2" },
    // `numeric` do PostgREST pode voltar string; critério legado não entra.
    category_scores: [
      { criterion_slug: "romance", score: "8.5" },
      { criterion_slug: "fantasy_nobility", score: 7 },
      { criterion_slug: "humor", score: null },
    ],
  },
  {
    id: "mixed",
    title: "Mixed",
    is_adult: false,
    edition_state: "mixed",
    calculated_scores: {
      expected_score: 7.1,
      alignment_score: null,
      scoring_contract: "s9-fantasy-b-edicao-v2",
      expected_by_edition: {
        normal: { expected_score: 7.9, expected_is_stub: false },
        r18: { expected_score: 7.1, expected_is_stub: false },
      },
    },
    category_scores: [{ criterion_slug: "adult_content", score: 9.5 }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  personal.clear()
  personal.set("simples", { synopsisQuality: "♥♥♥", readEdition: null, chaptersRead: 3, lastReadAt: null })
  personal.set("mixed", { synopsisQuality: null, readEdition: "r18", chaptersRead: 1, lastReadAt: null })
  const consulta = { select: () => consulta, eq: () => consulta, in: async () => ({ data: linhas, error: null }) }
  const estado = {
    select: () => estado,
    eq: () => estado,
    in: async (_c: string, ids: string[]) => ({
      data: ids.map((work_id) => ({ work_id, updated_at: "2026-10-08T10:00:00Z" })),
      error: null,
    }),
  }
  fromWorks.mockImplementation((tabela: string) => (tabela === "user_work_state" ? estado : consulta))
})

describe("obra sem data de leitura", () => {
  it("traz a última alteração só para quem não tem data, e nunca no lugar dela", async () => {
    personal.set("simples", { synopsisQuality: "♥♥♥", readEdition: null, chaptersRead: 3, lastReadAt: "2026-10-01" })
    const [simples, mixed] = await getReadingWorks({ statuses: ["Reading"] })
    expect(simples?.lastReadAt).toBe("2026-10-01")
    expect(simples?.lastTouchedAt).toBeNull()
    expect(mixed?.lastReadAt).toBeNull()
    expect(mixed?.lastTouchedAt).toBe("2026-10-08T10:00:00Z")
  })
})

describe("getReadingWorks traz o que os filtros consultam", () => {
  it("só critérios visíveis, com número de verdade", async () => {
    const [simples] = await getReadingWorks({ statuses: ["Reading"] })
    expect(simples?.criterionScores).toEqual({ romance: 8.5 })
    expect(simples?.alignmentScore).toBe(64)
    expect(simples?.synopsisQuality).toBe("♥♥♥")
    expect(simples?.byEdition).toBeNull()
    expect(simples?.defaultEdition).toBeNull()
  })

  it("obra mixed carrega cada edição com o que é dela, e nunca a nota misturada", async () => {
    const [, mixed] = await getReadingWorks({ statuses: ["Reading"] })
    expect(mixed?.readEdition).toBe("r18")
    expect(mixed?.defaultEdition).toBe("r18")
    expect(mixed?.byEdition).toEqual({
      normal: { expectedScore: 7.9, adultContent: null },
      r18: { expectedScore: 7.1, adultContent: 9.5 },
    })
  })

  it("sem obra mixed não consulta as notas por edição", async () => {
    const consulta = { select: () => consulta, eq: () => consulta, in: async () => ({ data: [linhas[0]], error: null }) }
    fromWorks.mockImplementation(() => consulta)
    await getReadingWorks({ statuses: ["Reading"] })
    expect(fetchEditionScoresFor).not.toHaveBeenCalled()
  })
})
