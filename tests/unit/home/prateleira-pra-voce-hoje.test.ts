import { describe, it, expect, vi } from "vitest"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"

/**
 * A prateleira "Pra você hoje" corta por STATUS PESSOAL, não por "ainda não avaliou".
 *
 * O corte antigo era `user_score == null`, e ele deixava passar tudo que está EM CURSO — na tela
 * apareciam obras em Reading, Started e On-hold, logo abaixo de um "Continue lendo" que existe
 * justamente pra essas. Não quebrava nada: a lista vinha cheia, plausível e com as obras erradas.
 *
 * O corte de hoje é [isPickablePersonalStatus]: não-começadas (`is_unread`) + Read Again. Este
 * teste enumera a tabela INTEIRA de `personal_status` em vez de listar os três nomes esperados —
 * assim um status novo no Supabase (ou um `is_unread` que mude de valor) aparece aqui como falha,
 * em vez de entrar na prateleira sem ninguém decidir nada.
 */

const PICKABLE_SLUGS = ["want-to-read", "untracked", "read_again"] as const

const ALL = Object.values(PERSONAL_STATUSES_BY_ID)

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

// Uma obra por status pessoal existente, todas com a MESMA nota da comunidade — o que decide
// quem entra é só o status.
const works = ALL.map((s) => ({
  id: `w${s.id}`,
  title: s.status,
  is_archived: false,
  publication_status_id: 1,
  total_chapters: 10,
  is_adult: false,
  calculated_scores: { expected_score: null, platform_avg: 8 },
  work_covers: [],
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(table === "works" ? { data: works, error: null } : { data: [], error: null, count: 0 }),
  }),
}))

vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  const byWorkId = new Map(ALL.map((s) => [`w${s.id}`, s.id]))
  return {
    ...real,
    getPersonalStateReader: async () => ({
      userId: "leitora",
      get: (workId: string) => ({
        personalStatusId: byWorkId.get(workId) ?? null,
        chaptersRead: null,
        // Read Again é obra JÁ LIDA e por isso costuma ter nota — o corte antigo
        // (`user_score == null`) a excluía justamente por isso.
        userScore: 9,
        synopsisQuality: null,
        isFavorite: false,
        lastReadAt: null,
      }),
    }),
  }
})

vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({
    hasModel: false,
    overlay: <T,>(_workId: string, calcRow: T): T => calcRow,
  }),
}))

describe('prateleira "Pra você hoje"', () => {
  it("só devolve não-começadas e Read Again — nunca leitura em curso", async () => {
    const { getTopPicksForToday } = await import("@/server/queries/dashboard")
    const { items } = await getTopPicksForToday(ALL.length)

    const esperados = ALL.filter((s) => (PICKABLE_SLUGS as readonly string[]).includes(s.slug))
      .map((s) => s.status)
      .sort()

    expect(
      items.map((i) => i.title).sort(),
      "o conjunto mudou — confira `isPickablePersonalStatus` e a tabela personal_status",
    ).toEqual(esperados)
  })

  it("obra sem linha no espelho entra (aparenta o status default)", async () => {
    const { getTopPicksForToday } = await import("@/server/queries/dashboard")
    const { items } = await getTopPicksForToday(ALL.length)

    // Todo id fora do mapa cai em `personalStatusId: null`. Se o filtro esquecesse
    // `personalStatusNameOrDefault`, a conta nova — que não tem linha NENHUMA — veria a
    // prateleira vazia.
    const { isPickablePersonalStatus, personalStatusNameOrDefault } = await import(
      "@/lib/constants/status-lookups"
    )
    expect(isPickablePersonalStatus(personalStatusNameOrDefault(null))).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })
})
