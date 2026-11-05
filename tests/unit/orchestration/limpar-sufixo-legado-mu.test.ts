import { describe, it, expect } from "vitest"

import { separarSufixoLegado, TETO_DO_CONECTOR } from "@/scripts/lib/mu-sufixo-legado.mjs"
import { hashAposLimpeza, planejarLimpeza } from "@/scripts/limpar-sufixo-legado-mangaupdates.mjs"

const CORPO = "Título do comentário: Bom\nNota do usuário: 8.0/10\nthe story remains as realistic and non-cliche as it goes on."
const RODAPE = " ... Last updated 6 years agoWas this comment useful? Yes No"
/** Texto que bateu no teto do conector, cortado no meio do sufixo dado. */
const noTeto = (sufixoCortado: string) =>
  `${CORPO} ${"x".repeat(TETO_DO_CONECTOR - CORPO.length - 1 - sufixoCortado.length)}${sufixoCortado}`

describe("separarSufixoLegado — só a forma exata do rodapé da página", () => {
  it("rodapé completo: sai inteiro, o corpo fica intacto", () => {
    expect(separarSufixoLegado(CORPO + RODAPE)).toEqual({ limpo: CORPO, sufixo: RODAPE, cortado: false })
    expect(separarSufixoLegado(`${CORPO} ... Last updated a year agoWas this comment useful? Yes No`)?.limpo).toBe(CORPO)
    expect(separarSufixoLegado(`${CORPO} ... Last updated 8 months agoWas this comment useful? Yes No`)?.limpo).toBe(CORPO)
  })

  it("rodapé cortado pelo teto de 900 (as formas que existem no banco)", () => {
    for (const cortado of [
      " ... Last updated 3 years agoWas this com",
      " ... Last updated 3 years agoW",
      " ... Last updated 3 years ag",
      " ... Last updated 9 month",
      " ... Last updated 2 ",
      " ... Last updated",
    ]) {
      const texto = noTeto(cortado)
      expect(texto).toHaveLength(TETO_DO_CONECTOR)
      expect(separarSufixoLegado(texto), cortado).toMatchObject({ sufixo: cortado, cortado: true })
    }
  })

  it("forma cortada em texto que NÃO bateu no teto não é rodapé", () => {
    expect(separarSufixoLegado(`${CORPO} ... Last updated 3 years ag`)).toBeNull()
    expect(separarSufixoLegado(`${CORPO} ... Last updated 3 years agoWas this com`)).toBeNull()
  })

  it("o que só se PARECE com o rodapé fica intocado", () => {
    expect(separarSufixoLegado(CORPO)).toBeNull()
    expect(separarSufixoLegado(`${CORPO} ... Last updated my list, then read again.`)).toBeNull()
    expect(separarSufixoLegado(`${CORPO} Last updated 6 years agoWas this comment useful? Yes No`)).toBeNull()
    expect(separarSufixoLegado(`${CORPO} ... Last updated 6 years agoWas this comment useful? No`)).toBeNull()
    // Rodapé sem corpo nenhum antes dele não vira review vazia.
    expect(separarSufixoLegado(RODAPE)).toBeNull()
  })
})

describe("planejarLimpeza", () => {
  const linha = (id: string, work_id: string, text: string) => ({ id, work_id, text, text_length: text.length })

  it("atualiza a suja e corrige o text_length", () => {
    const { acoes } = planejarLimpeza([linha("r1", "w1", CORPO + RODAPE)])
    expect(acoes).toEqual([
      expect.objectContaining({ id: "r1", acao: "atualizar", depois: CORPO, text_length_depois: CORPO.length }),
    ])
  })

  it("se a versão limpa já existe na MESMA obra, a suja sai em vez de virar 2ª cópia", () => {
    const { acoes } = planejarLimpeza([linha("r1", "w1", CORPO), linha("r2", "w1", CORPO + RODAPE)])
    expect(acoes).toEqual([expect.objectContaining({ id: "r2", acao: "apagar", depois: null })])
    // Em outra obra, o mesmo texto não é duplicata.
    expect(planejarLimpeza([linha("r1", "w1", CORPO), linha("r2", "w2", CORPO + RODAPE)]).acoes[0].acao).toBe("atualizar")
  })

  it("duas sujas que limpam para o mesmo texto: fica a MAIS ANTIGA, não a de menor id", () => {
    const outra = `${CORPO} ... Last updated 2 years agoWas this comment useful? Yes No`
    const { acoes } = planejarLimpeza([
      { ...linha("a-nova", "w1", CORPO + RODAPE), created_at: "2026-06-15T04:58:10.900Z" },
      { ...linha("b-antiga", "w1", outra), created_at: "2026-06-15T04:58:10.100Z" },
    ])
    expect(acoes.map((a) => [a.id, a.acao])).toEqual([
      ["b-antiga", "atualizar"],
      ["a-nova", "apagar"],
    ])
  })

  it("o plano guarda a linha INTEIRA, para o desfazer da apagada ser completo", () => {
    const suja = { ...linha("r2", "w1", CORPO + RODAPE), user_rating: 8, source_title: "X", match_score: 0.9 }
    const { acoes } = planejarLimpeza([linha("r1", "w1", CORPO), suja])
    expect(acoes[0].linha).toEqual(suja)
  })

  it("hashAposLimpeza: ressincroniza só o hash que estava EM DIA", () => {
    expect(hashAposLimpeza("h-antes", "h-antes", "h-depois")).toBe("h-depois")
    // Já divergia: há mudança anterior a esta limpeza, e escondê-la apagaria um sinal real.
    expect(hashAposLimpeza("h-velho", "h-antes", "h-depois")).toBeNull()
    expect(hashAposLimpeza(null, "h-antes", "h-depois")).toBeNull()
  })

  it("rodapé fora da régua é CONTADO e não entra no plano", () => {
    const estranha = `${CORPO} ... Last updated 6 years agoWas this comment useful? No`
    const { comRodape, naoReconhecidas, acoes } = planejarLimpeza([linha("r1", "w1", estranha), linha("r2", "w1", CORPO)])
    expect(comRodape).toHaveLength(1)
    expect(naoReconhecidas.map((l) => l.id)).toEqual(["r1"])
    expect(acoes).toEqual([])
  })
})
