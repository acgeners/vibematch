import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { autorDaNota } from "@/lib/criteria/nota-autor"

/**
 * "Nota trocada diz QUEM trocou" — a régua que a página aplica e a auditoria confere.
 *
 * 🔴 Havia um terceiro autor sem crédito: o LIMITE de `adult_content` move a nota e deixa
 * `source: ai_accepted`, então a ficha não dizia nada. Medido na nuvem em 2026-08-20: **85
 * obras**, **83** delas sem nenhum outro autor possível.
 *
 * ⚠️ O ramo `"limite"` nasceu sem executar em produção: depois do backfill de 20/08 as 83
 * fichas voltaram a ser COERENTES (a prosa passou a citar a faixa da nota), então a auditoria
 * conta 0 nele. Ramo que nunca roda é capacidade construída e desligada — é este teste que o
 * exercita.
 */
describe("autorDaNota", () => {
  const base = { source: "ai_accepted", exibida: 7, proposta: 7, limiteExplica: false }

  it("nota igual à proposta é do MODELO, qualquer que seja o source", () => {
    expect(autorDaNota(base)).toBe("modelo")
    expect(autorDaNota({ ...base, source: "ai_edited" })).toBe("modelo")
    expect(autorDaNota({ ...base, limiteExplica: true })).toBe("modelo")
  })

  it("meio ponto de diferença JÁ conta como movida", () => {
    // As notas andam de 0,5 em 0,5; um epsilon maior engoliria a menor troca possível.
    expect(autorDaNota({ ...base, exibida: 7.5, source: "ai_edited" })).toBe("curadoria")
  })

  it("credita a curadoria, a auditoria e o limite", () => {
    expect(autorDaNota({ ...base, exibida: 8, source: "ai_edited" })).toBe("curadoria")
    expect(autorDaNota({ ...base, exibida: 8, source: "ai_calibrated" })).toBe("auditoria")
    expect(autorDaNota({ ...base, exibida: 8, limiteExplica: true })).toBe("limite")
  })

  it("humano tem PRECEDÊNCIA sobre o limite quando os dois dão o mesmo número", () => {
    /**
     * 🔴 Não é hipótese: 2 obras do catálogo têm IA 6,0, piso 7,0 e persistida 7,0 com
     * `ai_edited`. Nenhum dado distingue quem decidiu, e creditar a máquina por uma decisão
     * dela é o mais caro dos dois erros.
     */
    expect(autorDaNota({ source: "ai_edited", exibida: 7, proposta: 6, limiteExplica: true })).toBe("curadoria")
    expect(autorDaNota({ source: "ai_calibrated", exibida: 7, proposta: 6, limiteExplica: true })).toBe("auditoria")
  })

  it("movida sem autor identificável é ÓRFÃ — e órfã não é 'modelo'", () => {
    // Na tela os dois se parecem (nenhum crédito), mas só um é defeito. Colapsá-los faria a
    // auditoria contar ficha órfã como saudável.
    expect(autorDaNota({ source: "ai_accepted", exibida: 8, proposta: 6, limiteExplica: false })).toBe("orfa")
  })

  it("nota ou proposta ausente não vira acusação", () => {
    expect(autorDaNota({ ...base, exibida: null })).toBe("modelo")
    expect(autorDaNota({ ...base, proposta: null })).toBe("modelo")
  })
})

describe("os dois consumidores derivam do mesmo dono", () => {
  const PAGINA = readFileSync(resolve(__dirname, "../../../app/catalog/[id]/page.tsx"), "utf8")
  const AUDITORIA = readFileSync(resolve(__dirname, "../../../scripts/coherence-audit.ts"), "utf8")

  it("a página escolhe o crédito por autorDaNota", () => {
    expect(PAGINA).toContain("autorDaNota(")
    expect(PAGINA).toMatch(/isUserEdited\s*=\s*autor === "curadoria"/)
    expect(PAGINA).toMatch(/isBoundLimited\s*=\s*autor === "limite"/)
  })

  it("a auditoria da tela classifica pelo mesmo dono", () => {
    expect(AUDITORIA).toContain("autorDaNota(")
    // 🔴 O que não pode voltar: a régua reescrita em `if`s próprios ao lado da chamada.
    const semComentarios = AUDITORIA.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(semComentarios).not.toMatch(/it\.source === "ai_edited"/)
    expect(semComentarios).not.toMatch(/if \(it\.limiteExplica\)/)
  })

  it("a página imprime os TRÊS créditos", () => {
    expect(PAGINA).toContain("Ajustada por você")
    expect(PAGINA).toContain("Ajustada pela auditoria")
    expect(PAGINA).toContain("Definida pelo limite obrigatório")
  })
})
