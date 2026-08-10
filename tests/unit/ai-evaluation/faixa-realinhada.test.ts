import { describe, expect, it } from "vitest"

import { realinharFaixaCitada } from "@/lib/ai-evaluation/service"

/**
 * O piso/teto de `adult_content` muda o NÚMERO; até 2026-08-10 não mexia no TEXTO. A
 * justificativa seguia abrindo com "Faixa 4-6 (Suggestive)" enquanto a nota já era 7,0 —
 * e a ficha da obra mostrava os dois lado a lado.
 *
 * Medido no catálogo com `scripts/coherence-audit.ts` (checagem A, n=8.673 atributos):
 * 149 casos de "faixa citada ≠ faixa da nota", **103 deles em adult_content**, quase todos
 * dessa origem. É a única incoerência que sobrou com instrumento confiável — as checagens
 * semânticas por regex reprovaram validação manual e foram removidas.
 */
describe("realinharFaixaCitada", () => {
  it("reescreve o rótulo quando o clamp moveu a nota pra outra faixa", () => {
    const antes = "Faixa 4-6 (Suggestive): a obra NÃO é smut, no máximo insinuada."
    const depois = realinharFaixaCitada(antes, 7.0)
    expect(depois).toContain("Faixa 7-8")
    expect(depois).toContain("limite obrigatório")
  })

  it("PRESERVA a conclusão original do modelo", () => {
    // Apagar o argumento seria pior que a incoerência: é justamente ele que revela que o
    // piso e a evidência textual discordam, e é isso que faz a curadora olhar o caso.
    const antes = "Faixa 4-6 (Suggestive): a obra NÃO é smut, no máximo insinuada."
    const depois = realinharFaixaCitada(antes, 7.0)
    expect(depois).toContain("a obra NÃO é smut, no máximo insinuada")
    expect(depois).toContain("conclui faixa 4-6")
  })

  it("não mexe quando a faixa citada já bate com a nota", () => {
    const j = "Faixa 7-8 (Mature): sexo mostrado parcialmente."
    expect(realinharFaixaCitada(j, 7.5)).toBe(j)
  })

  it("não inventa rótulo quando o modelo não citou faixa nenhuma", () => {
    // 5,1% das justificativas do Sonnet 5 fogem do formato `Faixa X-Y:` — nesses casos
    // não há o que realinhar, e escrever um rótulo do nada seria pior que não fazer nada.
    const j = "As tags do grupo content_indicator confirmam conteúdo sexual presente."
    expect(realinharFaixaCitada(j, 9)).toBe(j)
  })

  it("é idempotente — reaplicar não empilha rótulos", () => {
    const antes = "Faixa 4-6 (Suggestive): a obra NÃO é smut."
    const uma = realinharFaixaCitada(antes, 7.0)
    expect(realinharFaixaCitada(uma, 7.0)).toBe(uma)
  })
})

describe("realinharFaixaCitada — causa", () => {
  it("só afirma 'limite obrigatório' quando a causa foi provada", () => {
    // No backfill, 41 das 126 divergências NÃO têm impressão digital de clamp (a nota não
    // cai num valor de piso). Escrever 'limite obrigatório' nelas seria inventar um motivo
    // — o mesmo defeito que este realinhamento existe pra remover, com outra roupa.
    const j = "Faixa 4-6 (Suggestive): evidência moderada."
    expect(realinharFaixaCitada(j, 7.0, "limite")).toContain("limite obrigatório")
    const neutro = realinharFaixaCitada(j, 7.0, "desconhecida")
    expect(neutro).toContain("Faixa 7-8")
    expect(neutro).toContain("conclui faixa 4-6")
    expect(neutro).not.toContain("limite obrigatório")
  })
})

describe("realinharFaixaCitada — rótulo da faixa antiga", () => {
  it("não deixa o rótulo antigo órfão depois do novo número", () => {
    // "Faixa 4-6 (Suggestive)" → trocar só o número produziria
    // "Faixa 7-8 (…) (Suggestive)", e Suggestive é o rótulo de 4-6. A correção criaria
    // a incoerência que ela existe pra remover. Pego no dry-run do backfill.
    const r = realinharFaixaCitada("Faixa 4-6 (Suggestive): não é smut.", 7.0)
    expect(r).not.toMatch(/\)\s*\(Suggestive\)/)
    expect(r).toContain("conclui faixa 4-6 (Suggestive)")
    expect(r.match(/Suggestive/g)).toHaveLength(1)
  })

  it("funciona sem rótulo", () => {
    expect(realinharFaixaCitada("Faixa 4-6: evidência moderada.", 7.0)).toContain("conclui faixa 4-6)")
  })
})
