import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A guarda que impede a avaliação de gastar contra um banco que não conhece os critérios.
 *
 * 🔴 O caso REAL que a originou (2026-09-21): `CRITERION_SLUGS` com 11 slugs (Fantasy/Nobility
 * separados pela migration 197, aplicada só no LOCAL) contra a NUVEM com 9. O provider
 * respondeu, o insert de `ai_evaluation_scores` violou a FK, e o `throw` caiu ANTES do update
 * que grava a resposta — **US$0,0647** debitados e a avaliação salva vazia.
 */

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db-target", () => ({
  supabaseTargetLabel: () => "obwlwukwovetgjqdpizd.supabase.co",
  isLocalSupabaseUrl: () => false,
}))

const resposta: { data: unknown; error: unknown } = { data: [], error: null }
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: async () => resposta }) }),
  }),
}))

import { CRITERION_SLUGS } from "@/types/domain"
import { exigirCriteriosNoBanco } from "@/lib/ai-evaluation/criteria-guard"

const todos = () => CRITERION_SLUGS.map((slug) => ({ slug }))

beforeEach(() => {
  resposta.data = todos()
  resposta.error = null
})

describe("exigirCriteriosNoBanco", () => {
  it("passa quando o banco conhece todos os critérios do código", async () => {
    await expect(exigirCriteriosNoBanco()).resolves.toBeUndefined()
  })

  it("aborta NOMEANDO os que faltam — o caso Fantasy/Nobility", async () => {
    resposta.data = todos().filter((c) => c.slug !== "fantasy" && c.slug !== "nobility")

    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/fantasy/)
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/nobility/)
  })

  it("diz QUAL banco e que nada foi pago — senão a mensagem não é acionável", async () => {
    resposta.data = todos().slice(0, 3)

    // O host é o dado que decide: o mesmo código é válido num banco e inválido no outro.
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/obwlwukwovetgjqdpizd/)
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/[Nn]enhuma chamada paga/)
  })

  it("ZERO linha é FALHA, não sucesso — não houve o que conferir", async () => {
    resposta.data = []
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/nenhum critério/i)
  })

  it("falha FECHADA quando não consegue LER `criteria` — o error não pode ser ignorado", async () => {
    resposta.data = null
    resposta.error = { message: "column criteria.slug does not exist" }

    // A assimetria: não avaliar é reversível de graça; avaliar no escuro custa a chamada.
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/column criteria\.slug does not exist/)
  })
})
