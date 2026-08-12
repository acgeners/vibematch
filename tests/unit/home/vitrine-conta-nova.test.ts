import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * O que este arquivo prende são duas MENTIRAS que a vitrine contava pra conta nova — as duas
 * medidas em produção em 2026-08-04, com uma conta real recém-criada:
 *
 *   1. "957 quero ler" — o total de obras não-arquivadas do catálogo. `personalStatusNameOrDefault`
 *      dá o status DEFAULT ("Want to Read") a toda obra sem linha em `user_work_state`, e o laço
 *      dos KPIs percorre TODAS as obras ativas. Pra quem nunca marcou nada, o contador de
 *      atividade pessoal virava o tamanho do catálogo.
 *   2. "as maiores Notas Previstas que você ainda não leu" — sem modelo de gosto a prateleira cai
 *      em `platform_avg` (correto, e já era assim), mas o rótulo continuava prometendo Nota
 *      Prevista. Pior: o texto honesto que EXISTE na home ("o catálogo aparece pela nota da
 *      comunidade") só renderiza com a prateleira VAZIA — que é justamente o que não acontece
 *      pra quem não tem modelo, porque o fallback a enche.
 *
 * Nenhuma das duas quebra nada: sem erro, sem log, com número plausível na tela. É a classe de
 * bug que só um teste enxerga.
 */

const ACTIVE_WORKS = 40

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

const works = Array.from({ length: ACTIVE_WORKS }, (_, i) => ({
  id: `w${i}`,
  title: `Obra ${i}`,
  ai_eval_status: "done",
  is_archived: false,
  publication_status_id: 1,
  total_chapters: 10,
  is_adult: false,
  calculated_scores: { expected_score: null, platform_avg: 8 - i * 0.1 },
  work_covers: [],
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === "works"
          ? { data: works, error: null }
          : table === "calculated_scores"
            ? { data: works.map((w) => ({ work_id: w.id, expected_score: null })), error: null }
            : { data: [], error: null, count: 0 },
      ),
  }),
}))

// Conta nova: sessão existe, mas NENHUMA linha em user_work_state — é exatamente o estado que
// produziu o "957 quero ler".
vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    getPersonalStateReader: async () => ({
      userId: "conta-nova",
      get: () => ({
        personalStatusId: null,
        chaptersRead: null,
        userScore: null,
        synopsisQuality: null,
        isFavorite: false,
        lastReadAt: null,
      }),
    }),
  }
})

let hasModel = false
vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({
    hasModel,
    overlay: <T,>(_workId: string, calcRow: T): T => calcRow,
  }),
}))

beforeEach(() => {
  hasModel = false
})

describe("vitrine da home, conta nova", () => {
  it('não conta o catálogo inteiro como "quero ler"', async () => {
    const { getDashboardStats } = await import("@/server/queries/dashboard")
    const stats = await getDashboardStats()

    // O default continua valendo pra DISTRIBUIÇÃO (o /painel mostra "o catálogo, visto por
    // status") — é o contador de ATIVIDADE que não pode herdá-lo.
    expect(stats.byPersonalStatus["Want to Read"]).toBe(ACTIVE_WORKS)
    expect(
      stats.wantToRead,
      "quem nunca marcou nada tem 0 obras em 'quero ler', não o catálogo inteiro",
    ).toBe(0)
  })

  it("diz que a prateleira veio da nota da comunidade quando não há modelo", async () => {
    const { getTopPicksForToday } = await import("@/server/queries/dashboard")
    const semModelo = await getTopPicksForToday(5)

    expect(semModelo.items).toHaveLength(5)
    expect(
      semModelo.basis,
      "sem modelo a ordenação é platform_avg — o rótulo da home depende disto pra não mentir",
    ).toBe("platform")

    hasModel = true
    const comModelo = await getTopPicksForToday(5)
    expect(comModelo.basis).toBe("expected")
  })
})
