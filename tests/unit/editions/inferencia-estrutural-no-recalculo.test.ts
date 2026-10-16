import { beforeEach, describe, expect, it, vi } from "vitest"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"

/**
 * A inferência ESTRUTURAL por versão roda no RECÁLCULO global, e a posição é o que importa:
 *   · DEPOIS das guardas (código canônico e contrato de scoring) — um checkout defasado não pode
 *     gravar inferência, pelo mesmo motivo que não pode gravar previsão;
 *   · ANTES de qualquer leitura do catálogo — senão a previsão por versão sairia calculada com as
 *     linhas de ANTES da reconciliação, e a inferência só valeria no recálculo seguinte.
 *
 * O cliente admin é falso: o contrato responde, e toda outra leitura rejeita (como no teste do
 * contrato canônico). A ordem é a das tabelas tocadas, com a reconciliação registrada entre elas.
 */

vi.mock("server-only", () => ({}))
vi.mock("@/server/recalc/code-guard", () => ({ assertRecalcCodeAllowed: () => ({}) }))

const db = vi.hoisted(() => ({ ordem: [] as string[] }))

vi.mock("@/server/editions/structural-inference-sync", () => ({
  reconcileStructuralInferenceForRecalc: async () => {
    db.ordem.push("INFERENCIA_ESTRUTURAL")
    return null
  },
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      db.ordem.push(t)
      if (t === "canonical_contract") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { eval_prompt_versions: ["v32"], scoring_contracts: [SCORING_CONTRACT], enforce: true }, error: null }),
        }
        return q
      }
      const erro = () => Promise.reject(new Error(`PASSOU_DA_INFERENCIA: leu ${t}`))
      const cadeia: Record<string, unknown> = new Proxy({}, {
        get: (_a, prop) => (prop === "then" ? (ok: never, falha: (e: unknown) => unknown) => erro().then(ok, falha) : () => cadeia),
      })
      return cadeia
    },
    rpc: () => {
      throw new Error("PASSOU_DA_INFERENCIA: rpc")
    },
  }),
}))
vi.mock("@/server/queries/current-user", () => ({
  getCurrentUserId: async () => {
    db.ordem.push("getCurrentUserId")
    throw new Error("PASSOU_DA_INFERENCIA: getCurrentUserId")
  },
  getOwnerUserId: async () => "dono",
  ensureAdmin: async () => ({ ok: true }),
  ensurePermission: async () => ({ ok: false }),
}))

import { recalculateAll } from "@/server/actions/calculations"

beforeEach(() => {
  db.ordem.length = 0
})

describe("recalculateAll — a inferência estrutural entre as guardas e o catálogo", () => {
  it("roda logo depois do contrato canônico e antes de ler qualquer coisa do catálogo", async () => {
    await expect(recalculateAll("headless")).rejects.toThrow(/PASSOU_DA_INFERENCIA/)
    expect(db.ordem.slice(0, 2)).toEqual(["canonical_contract", "INFERENCIA_ESTRUTURAL"])
    expect(db.ordem.filter((x) => x === "INFERENCIA_ESTRUTURAL")).toHaveLength(1)
    // Nenhuma tabela do catálogo antes dela.
    expect(db.ordem.indexOf("INFERENCIA_ESTRUTURAL")).toBe(1)
  })
})
