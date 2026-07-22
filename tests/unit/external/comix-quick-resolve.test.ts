import { describe, it, expect, vi, beforeEach } from "vitest"

// `quickResolveComixHidForWork` existe pra rodar no CAMINHO CRÍTICO: a aquisição de
// reviews espera por ela. Então o que precisa ficar preso aqui não é "acha o hid" — é
// que ela NUNCA segura o pipeline além do orçamento, e que ela jamais escale pro caminho
// caro (spawn de Chrome ~60s, `ensureComixReady` com backoff de ~3min).
//
// Sem esse teto, um sidecar pendurado (timeout próprio de 25s × 2 tentativas ≈ 50s)
// atrasaria reviews + resumo + digest + tags de toda obra criada — e a `after()` ainda
// poderia morrer antes do fim, perdendo tudo. É o clássico "o conserto virou o problema".

const ensureComixHid = vi.fn()
let sidecarConfigured = true
let alreadyResolved = false

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => sidecarConfigured,
}))

vi.mock("@/server/actions/comix-hid", () => ({
  ensureComixHid: (...args: unknown[]) => ensureComixHid(...(args as [])),
}))

const chain = (result: unknown): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        }
        return () => chain(result)
      },
    },
  ) as Record<string, unknown>

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === "work_external_ids"
          ? { data: alreadyResolved ? { external_id: "003kd" } : null, error: null }
          : { data: { title: "Obra" }, error: null },
      ),
  }),
}))

// Dependências pesadas que o módulo carrega mas este caminho não toca.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/external/comix", () => ({ fetchComixById: async () => null, fetchComixReviews: async () => [] }))
vi.mock("@/lib/external/flaresolverr", () => ({ flareSolverrHealth: async () => ({ ok: false }) }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))

import { quickResolveComixHidForWork } from "@/server/comix/resolver"

beforeEach(() => {
  vi.clearAllMocks()
  sidecarConfigured = true
  alreadyResolved = false
})

describe("quickResolveComixHidForWork — o teto que protege o caminho crítico", () => {
  it("sidecar pendurado: desiste no orçamento em vez de segurar as reviews", async () => {
    // Nunca resolve — simula o sidecar que aceita a conexão e não responde.
    ensureComixHid.mockImplementation(() => new Promise(() => {}))
    const t0 = Date.now()
    const ok = await quickResolveComixHidForWork("w1", { budgetMs: 60 })
    const elapsed = Date.now() - t0
    expect(ok).toBe(false)
    expect(elapsed).toBeLessThan(1000) // desistiu no orçamento, não nos ~50s do sidecar
  })

  it("sem sidecar configurado: no-op IMEDIATO (prod hoje) — não tenta nada", async () => {
    sidecarConfigured = false
    ensureComixHid.mockResolvedValue("003kd")
    expect(await quickResolveComixHidForWork("w1")).toBe(false)
    expect(ensureComixHid).not.toHaveBeenCalled()
  })

  it("obra que já tem hid: true na hora, sem chamar o sidecar", async () => {
    alreadyResolved = true
    ensureComixHid.mockResolvedValue("003kd")
    expect(await quickResolveComixHidForWork("w1")).toBe(true)
    expect(ensureComixHid).not.toHaveBeenCalled()
  })

  it("caminho feliz: resolve dentro do orçamento", async () => {
    ensureComixHid.mockResolvedValue("003kd")
    expect(await quickResolveComixHidForWork("w1", { budgetMs: 2000 })).toBe(true)
    expect(ensureComixHid).toHaveBeenCalledTimes(1)
  })

  it("falha do sidecar não propaga — o pipeline segue sem a Comix", async () => {
    ensureComixHid.mockRejectedValue(new Error("sidecar 503"))
    await expect(quickResolveComixHidForWork("w1", { budgetMs: 2000 })).resolves.toBe(false)
  })

  it("workId vazio: false, sem tocar em nada", async () => {
    expect(await quickResolveComixHidForWork("")).toBe(false)
    expect(ensureComixHid).not.toHaveBeenCalled()
  })
})
