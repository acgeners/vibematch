import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Trocar a edição padrão das obras `mixed` muda o `adult_content` que entra na Nota Prevista. A conta
 * leitora já recalculava na hora (`recalculateForUser` em `after()`); a DONA só marcava a pendência, e
 * as telas que leem a edição padrão (home, similares, hover, descobrir, minha lista) ficavam com a
 * previsão da preferência ANTERIOR por 1h ou mais. Agora a dona marca E dispara o recálculo em
 * background — nessa ordem, para a marca ser o plano B se o disparo falhar.
 */
vi.mock("server-only", () => ({}))

const OWNER = "dona"
const LEITORA = "leitora"
let sessao = OWNER
const ordem: string[] = []
const gravado: Array<Record<string, unknown>> = []
const afters: Array<() => Promise<void>> = []

const markRecalcPending = vi.fn(async (ctx: string, opts: unknown) => { ordem.push(`mark:${ctx}`); void opts })
const recalculateScoresInBackground = vi.fn((ctx: string) => { ordem.push(`bg:${ctx}`) })
const recalculateForUser = vi.fn(async (id: string) => { ordem.push(`user:${id}`) })

vi.mock("@/server/recalc/queue", () => ({
  markRecalcPending: (c: string, o: unknown) => markRecalcPending(c, o),
  recalculateScoresInBackground: (c: string) => recalculateScoresInBackground(c),
  recalculateScoresNowResult: vi.fn(),
}))
vi.mock("@/server/recalc/user-recalc", () => ({ recalculateForUser: (id: string) => recalculateForUser(id) }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { afters.push(fn) } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => ({ ok: true }),
  ensureSignedIn: async () => ({ ok: true, userId: sessao }),
  getCurrentUserSettingsId: async () => "settings-1",
  getOwnerUserId: async () => OWNER,
  getSessionUserId: async () => sessao,
}))
/** UPDATE de user_settings: grava o payload e devolve a linha (o `.select("id")` da action). */
function fakeUpdateClient() {
  return {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        gravado.push(payload)
        const fim = { data: [{ id: "settings-1" }], error: null }
        const chain = { eq: () => chain, select: async () => fim, then: (ok: (v: unknown) => void) => ok(fim) }
        return chain
      },
    }),
  }
}
vi.mock("@/lib/supabase/user", () => ({ createUserClient: async () => fakeUpdateClient() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeUpdateClient() }))

beforeEach(() => {
  sessao = OWNER
  ordem.length = 0
  gravado.length = 0
  afters.length = 0
  markRecalcPending.mockClear()
  recalculateScoresInBackground.mockClear()
  recalculateForUser.mockClear()
})

describe("dona troca a edição padrão — marca a pendência E recalcula em background, nessa ordem", () => {
  it.each([
    ["normal → r18", "r18"],
    ["r18 → normal", "normal"],
  ])("%s", async (_caso, valor) => {
    const { setPreferredMixedEdition } = await import("@/server/actions/settings")
    expect(await setPreferredMixedEdition(valor)).toEqual({ error: null })
    expect(gravado).toEqual([{ preferred_mixed_edition: valor }])
    expect(markRecalcPending).toHaveBeenCalledWith("setPreferredMixedEdition", { changed: ["mixed_edition_preference"], actorId: OWNER })
    // A marca vem ANTES do disparo: é ela que segura o recálculo se o disparo falhar.
    expect(ordem).toEqual(["mark:setPreferredMixedEdition", "bg:setPreferredMixedEdition"])
    // O recálculo da dona é o GLOBAL (calculated_scores) — nunca o per-user.
    expect(afters).toHaveLength(0)
    expect(recalculateForUser).not.toHaveBeenCalled()
  })

  it("ocultar 18+ (que força a normal) segue o mesmo caminho", async () => {
    const { setHideAdultContent } = await import("@/server/actions/settings")
    expect(await setHideAdultContent(true)).toEqual({ error: null })
    expect(ordem).toEqual(["mark:setHideAdultContent", "bg:setHideAdultContent"])
  })

  it("valor inválido não grava, não marca e não recalcula", async () => {
    const { setPreferredMixedEdition } = await import("@/server/actions/settings")
    expect(await setPreferredMixedEdition("ambas")).toEqual({ error: "Versão inválida." })
    expect(gravado).toHaveLength(0)
    expect(ordem).toEqual([])
  })
})

describe("conta leitora — comportamento de antes, intacto", () => {
  it("recalcula a previsão DELA em after(); não marca nem dispara o recálculo global", async () => {
    sessao = LEITORA
    const { setPreferredMixedEdition } = await import("@/server/actions/settings")
    expect(await setPreferredMixedEdition("r18")).toEqual({ error: null })
    expect(markRecalcPending).not.toHaveBeenCalled()
    expect(recalculateScoresInBackground).not.toHaveBeenCalled()
    expect(afters).toHaveLength(1)
    await afters[0]()
    expect(recalculateForUser).toHaveBeenCalledWith(LEITORA)
  })
})

describe("plano B e deduplicação — a orquestração REAL do recálculo", () => {
  /** O estado de `formula_config`: só o recálculo bem-sucedido zera a pendência (como `recalculateAll`). */
  const montar = (falhasAntes: number) => {
    const estado = { pending: true, lastEditAt: "2026-10-11T12:00:00Z", calls: 0 }
    const deps = {
      codeGuard: () => ({ allow: true as const, provenance: { runtime: "local", basis: "canonical" } }),
      readPending: async () => ({ pending: estado.pending, lastEditAt: estado.lastEditAt }),
      recalc: async () => {
        estado.calls++
        if (estado.calls <= falhasAntes) throw new Error("recalc caiu")
        estado.pending = false
        return { recalculated: 1 }
      },
    }
    return { estado, deps }
  }

  it("o disparo imediato FALHA ⇒ a pendência fica; o disparo seguinte (1h ou botão) recalcula e a zera", async () => {
    const { ensureRecalculateScores } = await import("@/lib/orchestration/integrations/recalculate-scores")
    const { InMemoryJobStore } = await import("@/lib/orchestration/jobs")
    const { __resetSingleFlight } = await import("@/lib/ai-cache/single-flight")
    __resetSingleFlight()
    const { estado, deps } = montar(1)
    const jobStore = new InMemoryJobStore()
    expect((await ensureRecalculateScores({ ...deps, jobStore })).status).toBe("failed")
    expect(estado.pending).toBe(true)
    expect((await ensureRecalculateScores({ ...deps, jobStore })).status).toBe("succeeded")
    expect(estado.pending).toBe(false)
  })

  it("dois disparos ao mesmo tempo (o da troca + o da navegação) ⇒ UMA execução", async () => {
    const { ensureRecalculateScores } = await import("@/lib/orchestration/integrations/recalculate-scores")
    const { InMemoryJobStore } = await import("@/lib/orchestration/jobs")
    const { __resetSingleFlight } = await import("@/lib/ai-cache/single-flight")
    __resetSingleFlight()
    const { estado, deps } = montar(0)
    const jobStore = new InMemoryJobStore()
    const [a, b] = await Promise.all([ensureRecalculateScores({ ...deps, jobStore }), ensureRecalculateScores({ ...deps, jobStore })])
    expect([a.status, b.status]).toEqual(["succeeded", "succeeded"])
    expect(estado.calls).toBe(1)
    expect(jobStore.records).toHaveLength(1)
  })

  it("depois de recalculado, um disparo atrasado não roda de novo (sem pendência ⇒ nada)", async () => {
    const { ensureRecalculateScores } = await import("@/lib/orchestration/integrations/recalculate-scores")
    const { InMemoryJobStore } = await import("@/lib/orchestration/jobs")
    const { estado, deps } = montar(0)
    estado.pending = false
    expect((await ensureRecalculateScores({ ...deps, jobStore: new InMemoryJobStore() })).status).toBe("fresh")
    expect(estado.calls).toBe(0)
  })
})
