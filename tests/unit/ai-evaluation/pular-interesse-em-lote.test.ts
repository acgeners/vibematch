import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
const gate = vi.hoisted(() => ({ ok: true }))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => (gate.ok ? { ok: true } : { ok: false, error: "Só o Curador do catálogo pode fazer isso." }),
  getOwnerUserId: async () => "dona",
}))
const mirrorOwnerState = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ error: null as string | null })))
vi.mock("@/server/queries/user-work-state", () => ({
  mirrorOwnerState,
  writeReadingState: vi.fn(),
  ensureReadingStateWriter: vi.fn(),
}))

import { skipSynopsisInterestForWorks } from "@/server/actions/synopsis-quality"

/**
 * "Pular selecionadas" na fila de Interesse: o mesmo "Pular" do card, em lote — uma escrita só
 * no espelho da dona, com a mesma trava de curadoria. É endpoint HTTP público ("use server"),
 * então a entrada é conferida.
 */
const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"

describe("skipSynopsisInterestForWorks", () => {
  beforeEach(() => {
    gate.ok = true
    mirrorOwnerState.mockClear()
  })

  it("grava as obras de uma vez no espelho, sem repetir", async () => {
    const res = await skipSynopsisInterestForWorks([A, B, A])
    expect(res.error).toBeUndefined()
    expect(mirrorOwnerState).toHaveBeenCalledTimes(1)
    expect(mirrorOwnerState.mock.calls[0][1]).toEqual([A, B])
    expect(mirrorOwnerState.mock.calls[0][2]).toEqual({ synopsis_interest_skipped: true })
  })

  it("recusa id que não é uuid, sem gravar", async () => {
    const res = await skipSynopsisInterestForWorks([A, "'; drop table works; --"])
    expect(res.error).toBeTruthy()
    expect(mirrorOwnerState).not.toHaveBeenCalled()
  })

  it("só a curadoria", async () => {
    gate.ok = false
    const res = await skipSynopsisInterestForWorks([A])
    expect(res.error).toMatch(/Curador/)
    expect(mirrorOwnerState).not.toHaveBeenCalled()
  })
})
