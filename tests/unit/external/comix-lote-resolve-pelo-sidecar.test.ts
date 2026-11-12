import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "node:events"

// Depois de um LOTE de criação, `resolveComixHidsPending` é a única chance de a obra ganhar a
// Comix sozinha. Até 2026-11-12 ele só chamava o script de Chrome, que não existe dentro de
// `.next/standalone` (onde o localhost:3000 roda): falhava com MODULE_NOT_FOUND em todo lote,
// sem ninguém ver. Hoje ele resolve obra por obra pelo sidecar — a mesma via do `createWork` — e
// o script fica só para o que sobrar.

const ensureComixHid = vi.fn()
const spawn = vi.fn()
const comLinha = new Set<string>()

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>()
  const fake = (...a: unknown[]) => spawn(...a)
  return { ...real, default: { ...real, spawn: fake }, spawn: fake }
})
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>()
  const fake = { openSync: () => 1, closeSync: () => {}, promises: { ...real.promises, mkdir: async () => undefined } }
  return { ...real, ...fake, default: { ...real, ...fake } }
})
vi.mock("@/lib/external/comix-render-client", () => ({ isComixRenderConfigured: () => true }))
vi.mock("@/server/actions/comix-hid", () => ({
  ensureComixHid: (...args: unknown[]) => ensureComixHid(...(args as [])),
}))

/** Cliente fake: `works` devolve o título; `work_external_ids` diz se a obra já tem hid. */
function cliente() {
  let workId = ""
  const q: Record<string, unknown> = {}
  const self = () => q
  Object.assign(q, {
    select: self,
    eq: (col: string, v: string) => {
      if (col === "work_id" || col === "id") workId = v
      return q
    },
    maybeSingle: async () => ({ data: comLinha.has(workId) ? { external_id: "hid-" + workId } : null, error: null }),
    single: async () => ({ data: { title: "Obra " + workId }, error: null }),
    then: (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res),
  })
  return q
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => cliente() }) }))

vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/external/comix", () => ({ fetchComixById: async () => null, collectComixReviews: async () => ({}) }))
vi.mock("@/lib/external/flaresolverr", () => ({ flareSolverrHealth: async () => ({ ok: false }) }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))

import { resolveComixHidsPending } from "@/server/comix/resolver"

beforeEach(() => {
  vi.clearAllMocks()
  comLinha.clear()
  spawn.mockImplementation(() => {
    const child = new EventEmitter()
    setTimeout(() => child.emit("close", 1), 0) // o script quebra, como na 3000
    return child
  })
})

describe("mop-up pós-lote — resolve pelo sidecar antes do script", () => {
  it("🔴 o sidecar resolve todas: o script de Chrome nem é chamado", async () => {
    ensureComixHid.mockResolvedValue("abc12")
    await resolveComixHidsPending(["w1", "w2"])
    expect(ensureComixHid).toHaveBeenCalledTimes(2)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("obra que já tem hid não chama o sidecar", async () => {
    comLinha.add("w1")
    ensureComixHid.mockResolvedValue("abc12")
    await resolveComixHidsPending(["w1", "w2"])
    expect(ensureComixHid).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("o que o sidecar não casa ainda vai para o script, uma vez só", async () => {
    ensureComixHid.mockResolvedValueOnce("abc12").mockResolvedValueOnce(null)
    await resolveComixHidsPending(["w1", "w2"])
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
