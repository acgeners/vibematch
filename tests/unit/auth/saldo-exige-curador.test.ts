/**
 * `getBalanceSummary` devolve o saldo da conta Anthropic do OPERADOR — quanto há,
 * quanto foi gasto e quantas chamadas. Todo módulo `"use server"` é superfície HTTP
 * pública, e o único freio dessa leitura era `{isAdmin && <CurationMenu/>}` em
 * `components/layout/top-nav.tsx`, ou seja estado de CLIENTE.
 *
 * 🔴 A contraprova de cada caso é o MESMO mock de query devolvendo saldo de verdade:
 * sem isso, "veio vazio" passaria verde por a query ter falhado, não por o gate ter
 * negado — que é exatamente o modo de falha que este teste existe para impedir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))

const ensureAdmin = vi.fn()
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: (...a: unknown[]) => ensureAdmin(...a),
  ensureSignedIn: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getCurrentUserSettingsId: vi.fn(),
  getSessionUserId: vi.fn(),
}))

const SALDO_REAL = {
  balanceUsd: 42.5,
  setAt: "2026-09-01T00:00:00.000Z",
  spentSinceUsd: 7.25,
  remainingUsd: 35.25,
  callsSince: 128,
}
const getAnthropicBalanceStatus = vi.fn(async () => SALDO_REAL)
vi.mock("@/server/queries/ai-usage", () => ({
  getAnthropicBalanceStatus: () => getAnthropicBalanceStatus(),
  getOperatorSettingsId: vi.fn(),
}))

const { getBalanceSummary } = await import("@/server/actions/account")

beforeEach(() => {
  ensureAdmin.mockReset()
  getAnthropicBalanceStatus.mockClear()
  getAnthropicBalanceStatus.mockResolvedValue(SALDO_REAL)
})

describe("getBalanceSummary: o saldo do operador exige curador", () => {
  it("SEM autorização devolve o status vazio — e nem chega a consultar o saldo", async () => {
    ensureAdmin.mockResolvedValue({ ok: false, error: "Só o Curador do catálogo pode fazer isso." })

    const r = await getBalanceSummary()

    expect(r.balanceUsd).toBeNull()
    expect(r.setAt).toBeNull()
    expect(r.remainingUsd).toBeNull()
    expect(r.spentSinceUsd).toBe(0)
    expect(r.callsSince).toBe(0)
    // O gate barra ANTES da query: sem isto o dado já teria saído do banco.
    expect(getAnthropicBalanceStatus).not.toHaveBeenCalled()
  })

  it("nenhum número real vaza no payload negado", async () => {
    ensureAdmin.mockResolvedValue({ ok: false, error: "negado" })
    const r = await getBalanceSummary()
    const texto = JSON.stringify(r)
    for (const v of [42.5, 7.25, 35.25, 128]) expect(texto).not.toContain(String(v))
  })

  it("COM autorização segue funcionando (contraprova: o mock devolve saldo de verdade)", async () => {
    ensureAdmin.mockResolvedValue({ ok: true })

    const r = await getBalanceSummary()

    expect(r).toEqual(SALDO_REAL)
    expect(getAnthropicBalanceStatus).toHaveBeenCalledTimes(1)
  })

  it("autorizado + query quebrada continua falha SILENCIOSA — não derruba o layout", async () => {
    ensureAdmin.mockResolvedValue({ ok: true })
    getAnthropicBalanceStatus.mockRejectedValue(new Error("PostgREST 402"))

    await expect(getBalanceSummary()).resolves.toEqual({
      balanceUsd: null,
      setAt: null,
      spentSinceUsd: 0,
      remainingUsd: null,
      callsSince: 0,
    })
  })
})
