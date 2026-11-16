import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }))

const state = {
  works: [] as Array<{ id: string; title: string; is_adult: boolean | null; edition_state: string | null }>,
  scores: [] as Array<{ work_id: string; criterion_slug: string; score: number | null }>,
  similar: [] as Array<{ id: string; title: string; similarity: number }>,
  hideAdult: false,
  viewer: null as string | null,
  byWork: {} as Record<string, Array<{ id: string; name: string; color: string | null }>>,
  extra: [] as Array<{ id: string; title: string; is_adult: boolean | null; edition_state: string | null }>,
}

vi.mock("@/lib/supabase/paginate", () => ({
  fetchAllRows: vi.fn(async (_build: unknown, opts: { label: string }) =>
    opts.label.includes("obras") ? state.works : state.scores,
  ),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: state.similar, error: null }),
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        in: async () => ({ data: state.extra, error: null }),
      }
      return q
    },
  }),
}))
vi.mock("@/server/queries/current-user", () => ({
  getHideAdultContent: async () => state.hideAdult,
  getSessionUserId: async () => state.viewer,
}))
vi.mock("@/server/queries/lists", () => ({
  getGroupMembership: async () => ({ byWork: state.byWork, nested: [], totalGroups: 2 }),
}))

import { getBussolaLinksFor } from "@/server/queries/bussola-links"
import { linkRows, profileNeighbors, PROFILE_DISTANCE_CUT } from "@/lib/ranking/bussola-links"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"

/**
 * As ligações do painel da Bússola: o que vem do catálogo (parecidas, mesmo perfil) e o que é de
 * quem olha (grupos de favoritos).
 */

const scoresOf = (workId: string, base: number) =>
  SCORING_CRITERION_SLUGS.map((s, i) => ({ work_id: workId, criterion_slug: s, score: base + (i % 2) * 0.5 }))

beforeEach(() => {
  state.works = [
    { id: "alvo", title: "Alvo", is_adult: false, edition_state: null },
    { id: "perto", title: "Perto", is_adult: false, edition_state: null },
    { id: "adulta", title: "Adulta", is_adult: true, edition_state: null },
    { id: "longe", title: "Longe", is_adult: false, edition_state: null },
    { id: "mista", title: "Mista", is_adult: false, edition_state: "mixed" },
  ]
  state.scores = [
    ...scoresOf("alvo", 6),
    ...scoresOf("perto", 6.2),
    ...scoresOf("adulta", 6.1),
    ...scoresOf("longe", 9),
    // obra sem as 9 notas: fica fora do perfil, sem quebrar nada
    { work_id: "mista", criterion_slug: "romance", score: 6 },
  ]
  state.similar = [
    { id: "perto", title: "Perto", similarity: 0.36 },
    { id: "adulta", title: "Adulta", similarity: 0.3 },
  ]
  state.hideAdult = false
  state.viewer = null
  state.byWork = {}
  state.extra = []
})

describe("getBussolaLinksFor", () => {
  it("mesmo perfil = distância nas 9 notas até o corte, da mais próxima à mais distante", async () => {
    const r = await getBussolaLinksFor("alvo")
    expect(r.profile?.map((p) => p.id)).toEqual(["adulta", "perto"])
    expect(r.profile?.every((p) => p.distance <= PROFILE_DISTANCE_CUT)).toBe(true)
    expect(r.profileTotal).toBe(2)
  })

  it("obra sem as 9 notas não tem perfil: null, não lista vazia", async () => {
    const r = await getBussolaLinksFor("mista")
    expect(r.profile).toBeNull()
  })

  it("🔴 quem esconde 18+ não vê obra 18+ em nenhuma lista do painel", async () => {
    state.hideAdult = true
    const r = await getBussolaLinksFor("alvo")
    expect(r.similar.map((s) => s.id)).toEqual(["perto"])
    expect(r.profile?.map((p) => p.id)).toEqual(["perto"])
    expect(r.profileTotal).toBe(1)
  })

  it("o selo vem do catálogo: obra adulta e obra mixed chegam marcadas", async () => {
    state.similar = [
      { id: "adulta", title: "Adulta", similarity: 0.3 },
      { id: "mista", title: "Mista", similarity: 0.29 },
    ]
    const r = await getBussolaLinksFor("alvo")
    expect(r.similar.find((s) => s.id === "adulta")?.isAdult).toBe(true)
    expect(r.similar.find((s) => s.id === "mista")?.isMixed).toBe(true)
  })

  it("🔴 sem sessão, grupos é null — nunca os grupos do dono", async () => {
    state.byWork = { alvo: [{ id: "g1", name: "Spicy", color: null }], perto: [{ id: "g1", name: "Spicy", color: null }] }
    const r = await getBussolaLinksFor("alvo")
    expect(r.groups).toBeNull()
  })

  it("com sessão, lista quem divide um grupo com a obra, com o nome dos grupos em comum", async () => {
    state.viewer = "u1"
    state.byWork = {
      alvo: [{ id: "g1", name: "Spicy", color: null }, { id: "g2", name: "Ideal", color: null }],
      perto: [{ id: "g1", name: "Spicy", color: null }, { id: "g2", name: "Ideal", color: null }],
      longe: [{ id: "g3", name: "Outro", color: null }],
      nova: [{ id: "g2", name: "Ideal", color: null }],
    }
    state.extra = [{ id: "nova", title: "Obra nova", is_adult: false, edition_state: null }]
    const r = await getBussolaLinksFor("alvo")
    const byId = new Map(r.groups!.map((g) => [g.id, g]))
    expect(byId.get("perto")?.groups).toEqual(["Spicy", "Ideal"])
    expect(byId.has("longe")).toBe(false)
    // obra que entrou depois do índice em cache é buscada à parte, não some
    expect(byId.get("nova")?.title).toBe("Obra nova")
  })
})

describe("linhas do painel", () => {
  const links = {
    similar: [
      { id: "m", title: "No mapa", isAdult: false, isMixed: false, similarity: 0.35 },
      { id: "f", title: "Fora", isAdult: false, isMixed: false, similarity: 0.3 },
    ],
    profile: [{ id: "m", title: "No mapa", isAdult: false, isMixed: false, distance: 2.1 }],
    profileTotal: 1,
    groups: [
      { id: "f", title: "Fora", isAdult: false, isMixed: false, groups: ["A"] },
      { id: "m", title: "No mapa", isAdult: false, isMixed: false, groups: ["A", "B"] },
    ],
  }

  it("marca quem está no mapa e escreve o porquê no formato da tela", () => {
    const rows = linkRows(links, "similar", new Set(["m"]))!
    expect(rows.map((r) => [r.id, r.onMap, r.why])).toEqual([
      ["m", true, "35% parecida"],
      ["f", false, "30% parecida"],
    ])
    const perfil = linkRows(links, "profile", new Set(["m"]))!
    expect(perfil[0].why).toBe("≈ 0,7 pt/atributo")
  })

  it("em Mesmo grupo, as do mapa vêm primeiro (não há força para ordenar)", () => {
    const rows = linkRows(links, "groups", new Set(["m"]))!
    expect(rows.map((r) => r.id)).toEqual(["m", "f"])
    expect(rows[0].why).toBe("A · B")
  })

  it("null continua null: 'não dá para saber' não vira 'não há nenhuma'", () => {
    expect(linkRows({ ...links, groups: null }, "groups", new Set())).toBeNull()
    expect(linkRows({ ...links, profile: null }, "profile", new Set())).toBeNull()
  })

  it("profileNeighbors devolve null para obra sem vetor", () => {
    expect(profileNeighbors([], "x")).toBeNull()
  })
})
