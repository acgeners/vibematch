/**
 * As 6 exports de `server/actions/settings-read.ts` MUTAM com `createAdminClient()`
 * (service role, que ignora RLS) sobre tabelas GLOBAIS — `settings_read_acks` é
 * chaveada por `section`, sem `user_id`. Até 2026-09-25 o que as protegia era o
 * middleware barrar `/curation`: gate de ROTA, não de AÇÃO. Como módulo `"use server"`
 * é superfície HTTP pública, um POST direto silenciava (ou ressuscitava) os badges de
 * pendência do curador.
 *
 * 🔴 O teste é PARAMETRIZADO e deriva a lista do próprio módulo: export nova sem gate
 * reprova sozinha, em vez de depender de alguém lembrar de acrescentá-la aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const ensurePermission = vi.fn()
vi.mock("@/server/queries/current-user", () => ({
  ensurePermission: (...a: unknown[]) => ensurePermission(...a),
}))

// Qualquer toque no banco é falha do teste: negado não pode chegar aqui.
const createAdminClient = vi.fn(() => {
  throw new Error("TOCOU NO BANCO sem autorização")
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }))
vi.mock("@/server/queries/settings-pending", () => ({
  getSettingsItemPending: vi.fn(async () => ({})),
}))

const mod = await import("@/server/actions/settings-read")

/** Um argumento plausível por export — o gate tem de barrar ANTES da validação. */
const ARGS: Record<string, unknown[]> = {
  markSettingsSectionRead: ["fontes"],
  unmarkSettingsSectionRead: ["fontes"],
  markSuggestionRead: ["abc"],
  unmarkSuggestionRead: ["abc"],
  markAllSettingsRead: [],
  unmarkAllSettingsRead: [],
}

const exports = Object.entries(mod).filter(
  (e): e is [string, (...a: unknown[]) => Promise<unknown>] => typeof e[1] === "function",
)

beforeEach(() => {
  ensurePermission.mockReset()
  createAdminClient.mockClear()
})

describe("settings-read: toda mutação se defende sozinha", () => {
  it("o módulo expõe exatamente as 6 mutações conhecidas", () => {
    expect(exports.map(([n]) => n).sort()).toEqual(Object.keys(ARGS).sort())
  })

  for (const [nome, fn] of exports) {
    it(`${nome}: NEGADO sem permissão, e sem tocar no banco`, async () => {
      ensurePermission.mockResolvedValue({ ok: false, error: "Só o Curador do catálogo pode fazer isso." })

      await expect(fn(...(ARGS[nome] ?? []))).rejects.toThrow(/Curador/)
      // O gate barra antes de qualquer client: se o banco foi tocado, o gate veio tarde.
      expect(createAdminClient).not.toHaveBeenCalled()
    })

    it(`${nome}: pede a permissão global_config`, async () => {
      ensurePermission.mockResolvedValue({ ok: false, error: "negado" })
      await expect(fn(...(ARGS[nome] ?? []))).rejects.toThrow()
      expect(ensurePermission).toHaveBeenCalledWith("global_config")
    })
  }
})
