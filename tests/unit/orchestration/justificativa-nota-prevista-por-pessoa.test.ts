import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A justificativa da Nota Prevista é a conta do modelo de ALGUÉM. Mostrar a do dono a outra pessoa
 * explicaria uma nota que não é a dela — e com o gosto dele em cada linha ("tags que você evita
 * −0,30"). Mesma bifurcação do `getScoresReader`: sem sessão nada, dono `calculated_scores`, os
 * demais a linha DELES em `user_calculated_scores`.
 */

vi.mock("server-only", () => ({}))

const sessao = { id: null as string | null }
vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: async () => sessao.id,
  getOwnerUserId: async () => "dono",
}))

type Chamada = { tabela: string; filtros: Array<[string, unknown]> }
const chamadas: Chamada[] = []
const resposta = { data: null as unknown, error: null as { message: string } | null }

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      const c: Chamada = { tabela, filtros: [] }
      chamadas.push(c)
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          c.filtros.push([col, val])
          return q
        },
        order: () => q,
        range: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: resposta.data, error: resposta.error }),
      }
      return q
    },
  }),
}))

import { getExpectedExplanation, PERSONAL_SCORE_FIELDS } from "@/server/queries/user-scores"

const EXPL = { v: 1, base: 7, contributions: { romance: 0.2 }, obs: 0, score: 7.2 }

describe("getExpectedExplanation: a justificativa é de quem olha", () => {
  beforeEach(() => {
    chamadas.length = 0
    resposta.data = { expected_explanation: EXPL, expected_edition: null }
    resposta.error = null
  })

  it("sem sessão não lê nada — não há nota pessoal para explicar", async () => {
    sessao.id = null
    expect(await getExpectedExplanation("w1")).toBeNull()
    expect(chamadas).toEqual([])
  })

  it("dono lê calculated_scores", async () => {
    sessao.id = "dono"
    const r = await getExpectedExplanation("w1")
    expect(r?.column).toEqual(EXPL)
    expect(chamadas.map((c) => c.tabela)).toEqual(["calculated_scores"])
  })

  it("outra pessoa lê a linha DELA — nunca a do dono", async () => {
    sessao.id = "leitora"
    await getExpectedExplanation("w1")
    // A última leitura é a da justificativa (antes dela, o leitor carrega as notas da pessoa).
    const leitura = chamadas.at(-1)!
    expect(leitura.tabela).toBe("user_calculated_scores")
    expect(leitura.filtros).toEqual([["user_id", "leitora"], ["work_id", "w1"]])
    expect(chamadas.some((c) => c.tabela === "calculated_scores")).toBe(false)
  })

  it("falha de leitura vira nada (com log), sem derrubar a página da obra", async () => {
    sessao.id = "dono"
    resposta.error = { message: "column calculated_scores.expected_explanation does not exist" }
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await getExpectedExplanation("w1")).toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe("o overlay e o espelho tratam a justificativa como pessoal", () => {
  it("o overlay a zera para quem não é o dono", () => {
    expect(PERSONAL_SCORE_FIELDS).toContain("expected_explanation")
  })

  it("o espelho per-user a grava, e o recálculo de outra conta sem modelo a anula", () => {
    const espelho = readFileSync("server/queries/owner-labels.ts", "utf8")
    const lista = espelho.slice(espelho.indexOf("const PERSONAL_SCORE_COLUMNS"), espelho.indexOf("] as const", espelho.indexOf("const PERSONAL_SCORE_COLUMNS")))
    expect(lista).toContain('"expected_explanation"')
    const perUser = readFileSync("server/recalc/user-recalc.ts", "utf8")
    expect(perUser).toMatch(/expected_explanation:\s*null/)
  })

  it("fica FORA do select que carrega a tabela inteira da pessoa (é o campo pesado)", () => {
    const src = readFileSync("server/queries/user-scores.ts", "utf8")
    const load = src.slice(src.indexOf("async function loadUserScores"))
    const select = load.slice(load.indexOf(".select("), load.indexOf(".eq(", load.indexOf(".select(")))
    expect(select).not.toContain("expected_explanation")
  })
})
