import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A guarda que impede a avaliação de gastar contra um banco que não conhece os critérios.
 *
 * 🔴 O caso REAL que a originou (2026-09-21): `CRITERION_SLUGS` com 11 slugs (Fantasy/Nobility
 * separados pela migration 197, aplicada só no LOCAL) contra a NUVEM com 9. O provider
 * respondeu, o insert de `ai_evaluation_scores` violou a FK, e o `throw` caiu ANTES do update
 * que grava a resposta — **US$0,0647** debitados e a avaliação salva vazia.
 *
 * 🔴 O caso que originou a BIFURCAÇÃO (2026-09-23): a mesma guarda barrou corretamente, mas
 * mandou "aplique neste banco a migration que cria esses critérios" sobre `fantasy_nobility`
 * e `nobility` — que existiam na tabela como `eval_type='Legado'`. Seguir a instrução teria
 * REVERTIDO o rollout da 198. Os dois estados pedem ações OPOSTAS, e o filtro no servidor os
 * tornava indistinguíveis; por isso os casos abaixo exigem que cada um NEGUE a orientação do
 * outro — verificar só a presença da frase certa passaria verde com as duas juntas.
 */

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db-target", () => ({
  supabaseTargetLabel: () => "obwlwukwovetgjqdpizd.supabase.co",
  isLocalSupabaseUrl: () => false,
}))

const resposta: { data: unknown; error: unknown } = { data: [], error: null }
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Sem `.eq()`: a guarda lê a tabela inteira de propósito. Um mock que só respondesse a
    // `.eq()` esconderia a regressão que este arquivo existe para pegar.
    from: () => ({ select: async () => resposta }),
  }),
}))

import { CRITERION_SLUGS } from "@/types/domain"
import { exigirCriteriosNoBanco } from "@/lib/ai-evaluation/criteria-guard"

const todos = () => CRITERION_SLUGS.map((slug) => ({ slug, eval_type: "IA" }))

/** As linhas que convivem com os critérios de IA na tabela real (31 linhas em 2026-09-23). */
const OUTRAS_FAMILIAS = [
  { slug: "taste_overall", eval_type: "Gosto" },
  { slug: "story", eval_type: "User" },
]

beforeEach(() => {
  resposta.data = todos()
  resposta.error = null
})

describe("exigirCriteriosNoBanco", () => {
  it("passa quando o banco conhece todos os critérios do código", async () => {
    await expect(exigirCriteriosNoBanco()).resolves.toBeUndefined()
  })

  it("passa mesmo com outras famílias de eval_type na tabela", async () => {
    resposta.data = [...todos(), ...OUTRAS_FAMILIAS]
    await expect(exigirCriteriosNoBanco()).resolves.toBeUndefined()
  })

  it("aborta NOMEANDO os que faltam — o caso setting_era/angst", async () => {
    resposta.data = todos().filter((c) => c.slug !== "setting_era" && c.slug !== "angst")

    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/setting_era/)
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/angst/)
  })

  it("diz QUAL banco e que nada foi pago — senão a mensagem não é acionável", async () => {
    resposta.data = todos().slice(0, 3)

    // O host é o dado que decide: o mesmo código é válido num banco e inválido no outro.
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/obwlwukwovetgjqdpizd/)
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/[Nn]enhuma chamada paga/)
  })

  it("ZERO linha é FALHA, não sucesso — não houve o que conferir", async () => {
    resposta.data = []
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/não devolveu nenhuma linha/i)
  })

  it("tabela CHEIA sem nenhum eval_type='IA' também é FALHA", async () => {
    // Sem este caso, tirar o filtro do servidor abriria um buraco novo: a tabela tem linhas,
    // a guarda vê `linhas.length > 0`, e nenhuma delas é avaliável.
    resposta.data = OUTRAS_FAMILIAS
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/nenhum critério com/i)
  })

  it("falha FECHADA quando não consegue LER `criteria` — o error não pode ser ignorado", async () => {
    resposta.data = null
    resposta.error = { message: "column criteria.slug does not exist" }

    // A assimetria: não avaliar é reversível de graça; avaliar no escuro custa a chamada.
    await expect(exigirCriteriosNoBanco()).rejects.toThrow(/column criteria\.slug does not exist/)
  })

  describe("o diagnóstico bifurca: migration faltando × checkout velho", () => {
    /** O estado real de 2026-09-23: o banco aposentou os dois, o checkout não sabia. */
    const comLegado = () => [
      ...todos().filter((c) => c.slug !== "fantasy"),
      { slug: "fantasy_nobility", eval_type: "Legado" },
      { slug: "nobility", eval_type: "Legado" },
      // `fantasy` existe mas aposentado ⇒ o código o quer e o banco não o aceita
      { slug: "fantasy", eval_type: "Legado" },
    ]

    it("slug AUSENTE da tabela ⇒ diagnóstico de migration/schema", async () => {
      resposta.data = todos().filter((c) => c.slug !== "angst")

      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/AUSENTES da tabela[\s\S]*angst/)
      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/falta mesmo a migration/i)
      // 🔴 A contraprova: não pode culpar o checkout quando o slug realmente não existe.
      await expect(exigirCriteriosNoBanco()).rejects.not.toThrow(/checkout esteja desatualizado/i)
    })

    it("slug existente como `Legado` ⇒ diagnóstico de código/checkout stale", async () => {
      resposta.data = comLegado()

      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/APOSENTADOS neste banco/i)
      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/eval_type='Legado'/)
      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/checkout esteja desatualizado/i)
      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/origin\/main/)
    })

    it("🔴 slug `Legado` NÃO manda aplicar migration — era o conselho que reverteria o rollout", async () => {
      resposta.data = comLegado()

      // Este é o caso que custou a sessão de 2026-09-23. A guarda tinha a informação e
      // mandava o oposto do certo.
      await expect(exigirCriteriosNoBanco()).rejects.toThrow(/NÃO aplique migration/i)
      await expect(exigirCriteriosNoBanco()).rejects.not.toThrow(/falta mesmo a migration/i)
    })

    it("os DOIS ao mesmo tempo: cada um recebe o seu diagnóstico", async () => {
      resposta.data = [
        ...todos().filter((c) => c.slug !== "fantasy" && c.slug !== "angst"),
        { slug: "fantasy", eval_type: "Legado" },
      ]

      const erro = await exigirCriteriosNoBanco().catch((e: Error) => e.message)
      expect(erro).toMatch(/APOSENTADOS neste banco[\s\S]*fantasy/)
      expect(erro).toMatch(/AUSENTES da tabela[\s\S]*angst/)
      expect(erro).toMatch(/[Nn]enhuma chamada paga/)
    })

    it("o comportamento de SEGURANÇA não mudou: aborta antes do provider em qualquer ramo", async () => {
      for (const data of [comLegado(), todos().filter((c) => c.slug !== "angst"), []]) {
        resposta.data = data
        await expect(exigirCriteriosNoBanco()).rejects.toThrow()
      }
    })
  })
})
