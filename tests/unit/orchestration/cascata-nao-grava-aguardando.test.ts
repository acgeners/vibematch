/**
 * A pergunta do "Gerar tudo" (custo, fontes) vive no diálogo, não no banco. Quando a fase
 * grátis para para perguntar, a obra volta ao estado que tinha antes — gravar "aguardando
 * autorização" deixava a obra presa nele quando a pessoa cancelava ou fechava a aba
 * (3 obras assim, desde agosto e setembro, em 13/11/2026).
 *
 * Comportamental: a fase grátis é INVOCADA e as escritas em `works.cascade_status`, gravadas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { restingCascadeStatus } from "@/lib/generate-all/status"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn(async () => {}), recalculateScoresNow: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: vi.fn(async () => ({ ok: true })) }))

let previous: string | null = "idle"
const writes: string[] = []

function chain(table: string): Record<string, unknown> {
  const self: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "update") {
        return (row: { cascade_status?: string }) => {
          if (table === "works" && row.cascade_status) writes.push(row.cascade_status)
          return chain(table)
        }
      }
      if (prop === "maybeSingle") {
        return async () =>
          table === "works"
            ? { data: { cascade_status: previous }, error: null }
            : { data: { external_id: "hid", is_rejected: false }, error: null }
      }
      if (prop === "then") {
        return (res: (v: unknown) => void) =>
          Promise.resolve({ data: [{ external_id: "hid", is_rejected: false }], error: null }).then(res)
      }
      return () => self
    },
  }) as Record<string, unknown>
  return self
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => chain(t) }) }))

let comixOk = true
vi.mock("@/server/comix/resolver", () => ({
  ensureComixReady: vi.fn(async () => ({ ok: comixOk })),
  resolveComixDataResilient: vi.fn(async () => {}),
}))
vi.mock("@/lib/external/comick-health", () => ({ ensureComicKReady: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/external/acquire-reviews", () => ({ acquireAndPersistWorkReviews: vi.fn(async () => {}) }))
vi.mock("@/server/queries/work-reviews", () => ({ countWorkReviews: vi.fn(async () => 12) }))
vi.mock("@/server/queries/work-card-meta", () => ({
  getWorkTagReviewCounts: vi.fn(async (ids: string[]) => new Map([[ids[0], { tagCount: 0, reviewCount: 12 }]])),
}))

const { generateAllWorkData } = await import("@/server/actions/generate-all")

beforeEach(() => {
  writes.length = 0
  previous = "idle"
  comixOk = true
})

describe("Gerar tudo — a pergunta não fica gravada na obra", () => {
  it("🔴 parada no custo: a obra volta ao estado de antes, nunca 'aguardando'", async () => {
    previous = "done"
    const r = await generateAllWorkData("obra-1")
    expect(r).toMatchObject({ status: "needs_authorization", reason: "cost" })
    expect(writes).toEqual(["verifying_sources", "done"])
  })

  it("🔴 parada nas fontes: idem", async () => {
    comixOk = false
    previous = "failed"
    const r = await generateAllWorkData("obra-1")
    expect(r).toMatchObject({ status: "needs_authorization", reason: "sources_unconfirmed" })
    expect(writes).toEqual(["verifying_sources", "failed"])
  })

  it("obra presa num estado de passagem volta para 'idle'", async () => {
    previous = "needs_authorization"
    await generateAllWorkData("obra-1")
    expect(writes.at(-1)).toBe("idle")
  })
})

describe("restingCascadeStatus", () => {
  it("só os estados de repouso voltam; passagem e ausência viram idle", () => {
    expect(restingCascadeStatus("done")).toBe("done")
    expect(restingCascadeStatus("failed")).toBe("failed")
    expect(restingCascadeStatus("idle")).toBe("idle")
    for (const s of ["needs_authorization", "verifying_sources", "generating", "blocked_manual"] as const) {
      expect(restingCascadeStatus(s)).toBe("idle")
    }
    expect(restingCascadeStatus(null)).toBe("idle")
    expect(restingCascadeStatus(undefined)).toBe("idle")
  })
})
