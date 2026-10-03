import { describe, it, expect, vi } from "vitest"

/**
 * Contrato canônico (migration 202) — a DECISÃO pura e a LEITURA do banco.
 *
 * O que se paga caro se regredir: contrato ausente virar bloqueio (pararia produção antes da
 * migration e o banco local depois do `db:pull`), ou erro de leitura virar "liberado" (a guarda
 * some calada exatamente quando não dá para conferir).
 */

vi.mock("server-only", () => ({}))

import { decidirContratoCanonico } from "@/lib/canonical-contract"
import type { ContratoCanonico } from "@/lib/canonical-contract"
import { exigirContratoDeScoring, lerContratoCanonico } from "@/server/queries/canonical-contract"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"

const contrato = (o: Partial<ContratoCanonico> = {}): ContratoCanonico => ({
  evalPromptVersions: ["v32"],
  scoringContracts: ["s9-fantasy-b-v1"],
  enforce: true,
  ...o,
})

/** Cliente falso: só `canonical_contract`, com a resposta que o teste mandar. */
function clienteCom(resposta: { data: unknown; error: { code?: string; message: string } | null }) {
  const tabelas: string[] = []
  const cliente = {
    from: (t: string) => {
      tabelas.push(t)
      const q = { select: () => q, eq: () => q, maybeSingle: async () => resposta }
      return q
    },
  }
  return { cliente: cliente as never, tabelas }
}

describe("decidirContratoCanonico", () => {
  it("contrato AUSENTE não impõe nada (banco antes da 202, ou o local depois do db:pull)", () => {
    expect(decidirContratoCanonico("avaliacao", null, "v1")).toEqual({ permitido: true, imposto: false })
    expect(decidirContratoCanonico("scoring", null, "qualquer")).toEqual({ permitido: true, imposto: false })
  })

  it("enforce = false não impõe nada, mesmo com a versão fora da lista", () => {
    expect(decidirContratoCanonico("avaliacao", contrato({ enforce: false }), "v31")).toEqual({ permitido: true, imposto: false })
  })

  it("enforce = true: dentro da lista passa", () => {
    expect(decidirContratoCanonico("avaliacao", contrato(), "v32")).toEqual({ permitido: true, imposto: true })
    expect(decidirContratoCanonico("scoring", contrato(), "s9-fantasy-b-v1")).toEqual({ permitido: true, imposto: true })
  })

  it("enforce = true: fora da lista recusa, nomeando o local e os permitidos", () => {
    const d = decidirContratoCanonico("avaliacao", contrato(), "v31")
    expect(d.permitido).toBe(false)
    if (d.permitido) return
    expect(d.mensagem).toMatch(/prompt_version v31/)
    expect(d.mensagem).toMatch(/v32/)
    expect(d.mensagem).toMatch(/Nenhuma chamada paga/)
  })

  it("os dois eixos são listas SEPARADAS — versão de prompt não vale como contrato de scoring", () => {
    expect(decidirContratoCanonico("scoring", contrato(), "v32").permitido).toBe(false)
    expect(decidirContratoCanonico("avaliacao", contrato(), "s9-fantasy-b-v1").permitido).toBe(false)
  })

  it("a lista aceita mais de um valor (a janela entre migration e deploy)", () => {
    const janela = contrato({ evalPromptVersions: ["v32", "v33"] })
    expect(decidirContratoCanonico("avaliacao", janela, "v32").permitido).toBe(true)
    expect(decidirContratoCanonico("avaliacao", janela, "v33").permitido).toBe(true)
  })
})

describe("lerContratoCanonico", () => {
  it("lê a linha 1 e mapeia os campos", async () => {
    const { cliente, tabelas } = clienteCom({
      data: { eval_prompt_versions: ["v32"], scoring_contracts: ["s9-fantasy-b-v1"], enforce: true },
      error: null,
    })
    expect(await lerContratoCanonico(cliente)).toEqual(contrato())
    expect(tabelas).toEqual(["canonical_contract"])
  })

  it("tabela ausente (PGRST205 / 42P01) = contrato ausente, não erro", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      const { cliente } = clienteCom({ data: null, error: { code, message: "relation does not exist" } })
      expect(await lerContratoCanonico(cliente)).toBeNull()
    }
  })

  it("sem linha = contrato ausente", async () => {
    const { cliente } = clienteCom({ data: null, error: null })
    expect(await lerContratoCanonico(cliente)).toBeNull()
  })

  it("QUALQUER outro erro LANÇA — não conseguir ler não é o mesmo que não existir", async () => {
    const { cliente } = clienteCom({ data: null, error: { code: "08006", message: "connection failure" } })
    await expect(lerContratoCanonico(cliente)).rejects.toThrow(/não consegui ler o contrato canônico/)
  })

  it("enforce NULL/ausente vira false (nunca liga por acidente)", async () => {
    const { cliente } = clienteCom({ data: { eval_prompt_versions: ["v32"], scoring_contracts: ["x"], enforce: null }, error: null })
    expect((await lerContratoCanonico(cliente))?.enforce).toBe(false)
  })
})

describe("exigirContratoDeScoring", () => {
  it(`passa quando o banco permite ${SCORING_CONTRACT}`, async () => {
    const { cliente } = clienteCom({ data: { eval_prompt_versions: ["v32"], scoring_contracts: [SCORING_CONTRACT], enforce: true }, error: null })
    await expect(exigirContratoDeScoring(cliente)).resolves.toBeUndefined()
  })

  it("recusa quando o banco impõe outro contrato", async () => {
    const { cliente } = clienteCom({ data: { eval_prompt_versions: ["v32"], scoring_contracts: ["s10-outro"], enforce: true }, error: null })
    await expect(exigirContratoDeScoring(cliente)).rejects.toThrow(/INCOMPATÍVEL[\s\S]*recalc_pending continua de pé/)
  })

  it("enforce desligado mantém o comportamento atual", async () => {
    const { cliente } = clienteCom({ data: { eval_prompt_versions: ["v32"], scoring_contracts: ["s10-outro"], enforce: false }, error: null })
    await expect(exigirContratoDeScoring(cliente)).resolves.toBeUndefined()
  })
})
