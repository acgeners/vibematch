import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Recorrência: em quantos grupos de favoritos a mesma obra aparece.
 *
 * O que este arquivo trava não é a contagem em si (contar é trivial) — é o que a medição de
 * 2026-08-15 mostrou que faz a contagem MENTIR:
 *
 *  1. grupo 100% contido em outro (`Best Spicy` ⊂ `Spicy`, 13 de 13 na nuvem): as obras dele
 *     ganham "2 grupos" sem convergência nenhuma, e é o card que precisa avisar;
 *  2. o corte do card derivado é 2+, sem limiar inventado, e a ORDEM é por recorrência;
 *  3. contagem e listagem saem do MESMO mapa (`groupCountsFrom`), senão a coluna mostra um
 *     número e a ordenação obedece outro;
 *  4. sem sessão, nada — [[gotcha-anonimo-vira-dono]].
 */

// ── fixture: 4 grupos, com um deles inteiro dentro de outro ────────────────────
const LISTS = [
  { id: "spicy", name: "Spicy", color: "348 78% 66%" },
  { id: "best", name: "Best Spicy", color: "348 78% 66%" },
  { id: "next", name: "Next", color: "42 88% 62%" },
  { id: "lendo", name: "Lendo agora", color: "283 63% 70%" },
]

// w1 nos quatro; w2 em spicy+best (o par aninhado); w3 só em spicy; w4 em next+lendo.
const ITEMS = [
  { list_id: "spicy", work_id: "w1" },
  { list_id: "spicy", work_id: "w2" },
  { list_id: "spicy", work_id: "w3" },
  { list_id: "best", work_id: "w1" },
  { list_id: "best", work_id: "w2" },
  { list_id: "next", work_id: "w1" },
  { list_id: "next", work_id: "w4" },
  { list_id: "lendo", work_id: "w1" },
  { list_id: "lendo", work_id: "w4" },
]

const WORKS = ["w1", "w2", "w3", "w4"].map((id) => ({
  id,
  is_archived: false,
  calculated_scores: { expected_score: 8 },
  category_scores: [],
  work_covers: [{ url: `https://cdn/${id}.jpg`, is_primary: true, position: 0 }],
}))

let sessionUserId: string | null = "dona"
let lists = LISTS
let items = ITEMS

const chain = (result: unknown): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        return () => chain(result)
      },
    },
  )

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "work_lists") return chain({ data: lists, error: null })
      if (table === "work_list_items") return chain({ data: items, error: null })
      if (table === "works") return chain({ data: WORKS, error: null })
      return chain({ data: [], error: null })
    },
  }),
}))

vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: async () => sessionUserId,
  getHideAdultContent: async () => false,
}))

vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({
    isOwner: true,
    hasModel: true,
    overlay: (_id: string, row: unknown) => row,
  }),
}))

vi.mock("@/server/queries/user-work-state", () => ({
  getPersonalStateReader: async () => ({ get: () => ({ isFavorite: true }) }),
  resolvePersonalFilterIds: async () => ["w1", "w2", "w3", "w4"],
}))

async function load() {
  // `cache()` do React memoiza por requisição; em teste não há requisição, então cada
  // `import` fresco garante que a fixture desta asserção é a que vale.
  vi.resetModules()
  return import("@/server/queries/lists")
}

beforeEach(() => {
  sessionUserId = "dona"
  lists = LISTS
  items = ITEMS
})

describe("getGroupMembership", () => {
  it("mapeia cada obra para os grupos a que pertence", async () => {
    const { getGroupMembership } = await load()
    const m = await getGroupMembership()

    expect(m.totalGroups).toBe(4)
    expect(m.byWork.w1.map((g) => g.name)).toEqual(["Spicy", "Best Spicy", "Next", "Lendo agora"])
    expect(m.byWork.w3.map((g) => g.name)).toEqual(["Spicy"])
    // A cor viaja junto — é o que o tooltip usa ao lado do nome.
    expect(m.byWork.w3[0].color).toBe("348 78% 66%")
  })

  it("acusa o grupo 100% contido em outro, e só nesse sentido", async () => {
    const { getGroupMembership } = await load()
    const { nested } = await getGroupMembership()

    // `Best Spicy` (w1, w2) está inteiro dentro de `Spicy` (w1, w2, w3).
    const spicy = nested.filter((n) => n.innerName === "Best Spicy")
    expect(spicy).toHaveLength(1)
    expect(spicy[0]).toMatchObject({ innerName: "Best Spicy", innerCount: 2, outerName: "Spicy" })

    // …e não o contrário: `Spicy` tem w3, que `Best Spicy` não tem.
    expect(nested.some((n) => n.innerName === "Spicy")).toBe(false)
  })

  it("NÃO confunde interseção parcial com aninhamento", async () => {
    // `Next` e `Lendo agora` compartilham w1 e w4 — mas nenhum contém o outro… até que
    // contenha: aqui eles têm exatamente os mesmos membros, e o par tem que ser reportado
    // UMA vez só (senão os dois cards acusariam um ao outro).
    const { getGroupMembership } = await load()
    const { nested } = await getGroupMembership()
    const entreOsDois = nested.filter((n) =>
      ["Next", "Lendo agora"].includes(n.innerName) && ["Next", "Lendo agora"].includes(n.outerName),
    )
    expect(entreOsDois).toHaveLength(1)
  })

  it("sem sessão devolve vazio — a visitante não herda os grupos do dono", async () => {
    sessionUserId = null
    const { getGroupMembership } = await load()
    const m = await getGroupMembership()
    expect(m).toEqual({ byWork: {}, nested: [], totalGroups: 0 })
  })
})

describe("groupCountsFrom", () => {
  it("deriva a contagem do MESMO mapa que nomeia os grupos", async () => {
    const { getGroupMembership, groupCountsFrom } = await load()
    const m = await getGroupMembership()
    const counts = groupCountsFrom(m)

    // A invariante que importa: para toda obra, o número que ORDENA é o tamanho da lista
    // que a célula MOSTRA. Não há como um evoluir sem o outro.
    for (const [workId, groups] of Object.entries(m.byWork)) {
      expect(counts[workId]).toBe(groups.length)
    }
    expect(counts).toEqual({ w1: 4, w2: 2, w3: 1, w4: 2 })
  })
})

describe("getMultiGroupFavorites", () => {
  it("corta em 2+ e ordena por recorrência desc", async () => {
    const { getMultiGroupFavorites } = await load()
    const multi = await getMultiGroupFavorites()

    // w3 (1 grupo) fica de fora; w1 (4) vem antes de w2/w4 (2 cada).
    expect(multi.workIds[0]).toBe("w1")
    expect(multi.workIds).toHaveLength(3)
    expect(multi.workIds).not.toContain("w3")
    expect(multi.maxGroups).toBe(4)
    // As capas saem das MAIS recorrentes, não das de maior nota (todas empatam em 8 aqui).
    // ⚠️ Cada slot do mosaico é uma OBRA e leva as CANDIDATAS dela, então é lista de listas.
    expect(multi.mosaicCovers[0]).toEqual(["https://cdn/w1.jpg"])
  })

  it("com um grupo só, “vários” não existe", async () => {
    lists = [LISTS[0]]
    items = ITEMS.filter((i) => i.list_id === "spicy")
    const { getMultiGroupFavorites } = await load()
    const multi = await getMultiGroupFavorites()
    expect(multi.workIds).toEqual([])
    expect(multi.summary.total).toBe(0)
  })

  it("com grupos que não se cruzam, o card não tem o que mostrar", async () => {
    items = [
      { list_id: "spicy", work_id: "w1" },
      { list_id: "next", work_id: "w2" },
    ]
    const { getMultiGroupFavorites } = await load()
    expect((await getMultiGroupFavorites()).workIds).toEqual([])
  })
})
