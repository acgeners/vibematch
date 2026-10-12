import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Ocultar/ver 18+ É a preferência que escolhe a versão PADRÃO das obras `mixed` (decisão de
 * 2026-10-12; `preferred_mixed_edition` saiu da experiência) — e muda o `adult_content` que entra na
 * Nota Prevista. A conta leitora recalcula na hora (`recalculateForUser` em `after()`); a DONA marca
 * a pendência E dispara o recálculo em background — nessa ordem, para a marca ser o plano B se o
 * disparo falhar.
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

describe("dona liga/desliga ocultar 18+ — marca a pendência E recalcula em background, nessa ordem", () => {
  it.each([
    ["ocultar (padrão R18 → normal)", true],
    ["mostrar (padrão normal → R18)", false],
  ])("%s", async (_caso, valor) => {
    const { setHideAdultContent } = await import("@/server/actions/settings")
    expect(await setHideAdultContent(valor)).toEqual({ error: null })
    expect(gravado).toEqual([{ hide_adult_content: valor }])
    expect(markRecalcPending).toHaveBeenCalledWith("setHideAdultContent", { changed: ["mixed_edition_preference"], actorId: OWNER })
    // A marca vem ANTES do disparo: é ela que segura o recálculo se o disparo falhar.
    expect(ordem).toEqual(["mark:setHideAdultContent", "bg:setHideAdultContent"])
    // O recálculo da dona é o GLOBAL (calculated_scores) — nunca o per-user.
    expect(afters).toHaveLength(0)
    expect(recalculateForUser).not.toHaveBeenCalled()
  })

  it("a action antiga da preferência de versão não existe mais", async () => {
    const settings = await import("@/server/actions/settings")
    expect("setPreferredMixedEdition" in settings).toBe(false)
  })
})

describe("conta leitora — recalcula só a DELA", () => {
  it("recalcula a previsão DELA em after(); não marca nem dispara o recálculo global", async () => {
    sessao = LEITORA
    const { setHideAdultContent } = await import("@/server/actions/settings")
    expect(await setHideAdultContent(false)).toEqual({ error: null })
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
