import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * O caminho que CONSOME `recalc_pending` sem ninguém clicar: toda carga de página chama
 * `getSidebarBadgeCounts` → `maybeTriggerStaleRecalc`, que dispara o recálculo em background quando
 * há pendência E a última edição tem ≥ 1h. É por isso que o "Edições da obra" (e todo
 * `markRecalcPending`) não pode prometer "só recalcula quando você autorizar".
 *
 * Aqui só a fila é real; banco, `after()` e o recálculo são falsos — nada roda de verdade.
 */
vi.mock("server-only", () => ({}))

const h = vi.hoisted(() => ({
  linha: null as Record<string, unknown> | null,
  rpcErro: null as string | null,
  afters: [] as Array<() => Promise<unknown>>,
  recalc: [] as unknown[],
}))

vi.mock("next/server", () => ({ after: (cb: () => unknown) => h.afters.push(async () => cb()) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: h.linha, error: null }) }
      return q
    },
    rpc: async () => ({ error: h.rpcErro ? { message: h.rpcErro } : null }),
  }),
}))
vi.mock("@/lib/orchestration/integrations/recalculate-scores", () => ({
  ensureRecalculateScores: async (deps: unknown) => {
    h.recalc.push(deps)
    return { status: "done" }
  },
}))
vi.mock("@/server/actions/calculations", () => ({ recalculateAll: vi.fn() }))
vi.mock("@/server/recalc/code-guard", () => ({ checkRecalcCode: () => ({ allow: true }) }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }), getOwnerUserId: async () => "dono" }))
vi.mock("@/server/queries/settings-pending", () => ({
  countMissingEmbeddings: async () => 0,
  countPendingCanonicalSynopses: async () => 0,
  countPendingReviewSummaries: async () => 0,
}))

import { markRecalcPending, maybeTriggerStaleRecalc } from "@/server/recalc/queue"

const haHoras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const rodarAfters = async () => {
  for (const f of h.afters.splice(0)) await f()
}

beforeEach(() => {
  h.linha = null
  h.rpcErro = null
  h.afters.length = 0
  h.recalc.length = 0
})

describe("recálculo automático na carga de página", () => {
  it("pendente há ≥ 1h ⇒ dispara sozinho (em background)", async () => {
    h.linha = { recalc_pending: true, recalc_last_edit_at: haHoras(2) }
    await expect(maybeTriggerStaleRecalc()).resolves.toMatchObject({ pending: true })
    await rodarAfters()
    expect(h.recalc).toHaveLength(1)
  })

  it("pendente há < 1h ⇒ espera (uma nova edição empurra a janela)", async () => {
    h.linha = { recalc_pending: true, recalc_last_edit_at: haHoras(0.5) }
    await maybeTriggerStaleRecalc()
    await rodarAfters()
    expect(h.recalc).toHaveLength(0)
  })

  it("nada pendente ⇒ não dispara", async () => {
    h.linha = { recalc_pending: false, recalc_last_edit_at: haHoras(5) }
    await maybeTriggerStaleRecalc()
    await rodarAfters()
    expect(h.recalc).toHaveLength(0)
  })

  it("marcar pendência NÃO recalcula na hora — só grava a marca", async () => {
    await markRecalcPending("saveWorkEditionCuration", { changed: ["edition_scores"] })
    await rodarAfters()
    expect(h.recalc).toHaveLength(0)
  })

  it("se a MARCA falhar, a fila recalcula em background na hora (plano B existente)", async () => {
    h.rpcErro = "rede"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await markRecalcPending("saveWorkEditionCuration", { changed: ["edition_scores"] })
    await rodarAfters()
    expect(h.recalc).toHaveLength(1)
    warn.mockRestore()
  })
})
