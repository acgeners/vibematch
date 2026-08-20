import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { aplicarLimiteAdulto } from "@/lib/ai-evaluation/adult-content-apply"
import { computeAdultContentBounds } from "@/lib/ai-evaluation/adult-content-rules"

/**
 * O par (nota, texto) de `adult_content` tem UM dono.
 *
 * 🔴 Havia dois caminhos escrevendo a mesma nota e só um escrevendo a explicação: o fluxo de
 * avaliação anexava a razão e realinhava a faixa; o `scripts/adult-content-retroactive-bounds.ts`
 * fazia `update({ score })` e ia embora. Como ele roda toda vez que uma tag ganha
 * `adult_score_tier` — e há ~119 no backlog —, ele reabastecia o defeito sozinho.
 *
 * Medido na nuvem em 2026-08-20 (987 notas de `adult_content` com texto): **0** fora do
 * piso/teto — os números estavam certos —, **89** com a nota movida e o texto sem razão
 * nenhuma, **7** citando um limite diferente do vigente e **81** com o MODELO narrando a regra,
 * errado em 5 casos conferidos um a um (obra com TETO 6,0 pela tag "R15 but Based on a R19
 * Novel" cuja prosa afirmava *"aplica piso obrigatório de 7.0"* — o contrário da precedência).
 */

const PISO_LABEL = computeAdultContentBounds({
  tags: [{ name: "R19", group: "content_indicator", scoreTier: "label" }],
})
const TETO_R15 = computeAdultContentBounds({
  tags: [
    { name: "R15 but Based on a R19 Novel", group: "content_indicator", scoreTier: null },
    { name: "R19", group: "content_indicator", scoreTier: "label" },
  ],
})
const SEM_LIMITE = computeAdultContentBounds({ tags: [{ name: "Fluffy", group: "theme" }] })

describe("aplicarLimiteAdulto", () => {
  it("sem limite nenhum, não toca nem a nota nem o texto", () => {
    const j = "Faixa 4-6 (Suggestive): insinuação, sem cena mostrada."
    const r = aplicarLimiteAdulto(5, j, SEM_LIMITE)
    expect(r).toEqual({ score: 5, justification: j, aplicou: false, razaoAcrescentada: false })
  })

  it("piso que MOVE a nota: clampa, anexa a razão e realinha a faixa citada", () => {
    const r = aplicarLimiteAdulto(5, "Faixa 4-6 (Suggestive): sem cena explícita.", PISO_LABEL)
    expect(r.score).toBe(7)
    expect(r.aplicou).toBe(true)
    expect(r.razaoAcrescentada).toBe(true)
    // a faixa da tela passa a ser a da NOTA, com a conclusão original preservada
    expect(r.justification).toContain("Faixa 7-8")
    expect(r.justification).toContain("conclui faixa 4-6")
    // e a razão nomeia a regra que decidiu
    expect(r.justification).toContain("adult_content ≥ 7.0")
  })

  it("teto: clampa para BAIXO e o texto diz TETO, não piso", () => {
    const r = aplicarLimiteAdulto(9, "Faixa 9-10 (Smut): tags de ato explícito.", TETO_R15)
    expect(r.score).toBe(6)
    expect(r.justification).toContain("TETO 6.0")
    // 🔴 A frase que os 5 casos errados do catálogo traziam. Ela não pode aparecer num teto.
    expect(r.justification).not.toMatch(/piso obrigatório de 7/i)
  })

  it("limite existe mas NÃO move: texto intacto", () => {
    // 🔴 O caso mais fácil de errar para o lado caro. A nota já está na faixa, então quem a
    // escolheu foi o modelo — anexar "o limite exige ≥7" afirmaria uma procedência que não
    // houve. Medido: é o que separa as 83 fichas que o backfill toca das ~300 que ele não toca.
    const j = "Faixa 7-8 (Mature): sexualização presente e relevante."
    const r = aplicarLimiteAdulto(8, j, PISO_LABEL)
    expect(r).toEqual({ score: 8, justification: j, aplicou: false, razaoAcrescentada: false })
  })

  it("é idempotente: reaplicar não empilha a razão", () => {
    const uma = aplicarLimiteAdulto(5, "Faixa 4-6 (Suggestive): sem cena.", PISO_LABEL)
    const duas = aplicarLimiteAdulto(5, uma.justification, PISO_LABEL)
    expect(duas.justification).toBe(uma.justification)
    expect(duas.razaoAcrescentada).toBe(false)
  })

  it("não duplica quando a LISTA DE TAGS da razão mudou — a assinatura é a frase da camada", () => {
    /**
     * ⚠️ As razões carregam as tags que acionaram a camada, e essa lista muda quando uma tag é
     * revisada (`adult_score_tier`). Comparar a razão inteira faria a próxima execução anexar
     * uma segunda razão quase idêntica no mesmo parágrafo — e o script roda de novo a cada
     * revisão de tier, então isso empilharia sem limite.
     */
    const outrasTags = computeAdultContentBounds({
      tags: [
        { name: "R19", group: "content_indicator", scoreTier: "label" },
        { name: "Adult", group: "content_indicator", scoreTier: "label" },
      ],
    })
    const uma = aplicarLimiteAdulto(5, "Faixa 4-6 (Suggestive): sem cena.", PISO_LABEL)
    const duas = aplicarLimiteAdulto(5, uma.justification, outrasTags)
    expect(duas.razaoAcrescentada).toBe(false)
    expect(duas.justification).toBe(uma.justification)
  })

  it("o prefixo descreve a NOTA, mesmo quando a razão anexada fala de outra faixa", () => {
    /**
     * ⚠️ Este caso NÃO distingue a ordem (anexar → realinhar × realinhar → anexar): conferido
     * com sonda, inverter mantém tudo verde, porque nenhuma razão usa o formato literal
     * "Faixa X-Y" que o realinhamento procura. O que ele protege é a invariante que a tela
     * consome — o rótulo da faixa é o da nota vigente —, e essa vale nas duas ordens.
     */
    const explicito = computeAdultContentBounds({
      tags: [{ name: "Anal Sex", group: "content_indicator", scoreTier: "explicit" }],
    })
    const r = aplicarLimiteAdulto(4, "Faixa 4-6 (Suggestive): reviews não confirmam.", explicito)
    expect(r.score).toBe(9)
    expect(r.justification.startsWith("Faixa 9-10 (definida pelo limite obrigatório")).toBe(true)
  })
})

describe("o script retroativo usa o dono, não uma segunda montagem", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../../../scripts/adult-content-retroactive-bounds.ts"),
    "utf8",
  )

  it("chama aplicarLimiteAdulto", () => {
    expect(SRC).toContain("aplicarLimiteAdulto(")
  })

  it("não remonta o texto por conta própria", () => {
    // O que ele fazia antes era só `update({ score })`; o risco agora é o inverso — alguém
    // montar `${justification} ${reasons}` aqui de novo, que é como as duas pontas divergiram.
    const semComentarios = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(semComentarios).not.toMatch(/reasons\.join\([^)]*\)\s*\}?`/)
    expect(semComentarios).not.toContain("realinharFaixaCitada(")
  })

  it("grava a justificativa na tabela certa e salva o estado anterior", () => {
    expect(SRC).toMatch(/from\("ai_evaluation_scores"\)[\s\S]{0,80}\.update\(\{ justification/)
    expect(SRC).toContain('podar("adult-content-razao")')
  })
})
