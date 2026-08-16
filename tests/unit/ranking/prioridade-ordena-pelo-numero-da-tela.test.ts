import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  DISPLAY_ROUNDED_SORT_FIELDS,
  displaySortValue,
  displayTierKey,
  isDisplayRoundedSortField,
} from "@/lib/ranking/display-sort"

/**
 * A invariante: **quem ordena por nota tem que ver o número que a tela mostra** —
 * e a Prioridade estava de fora dela.
 *
 * `DecisionCell` imprime `~${score.toFixed(1)}`, mas `compareByField` comparava
 * `decisionScore` CRU. Medido em 2026-08-15 no clone local (975 obras ativas com
 * Prioridade): pelo cru empatavam **229** pares; pela nota exibida, **19.624**.
 * Como a cadeia é `níveis escolhidos → overlap de tags → título`, quase nada
 * chegava depois do nível 1 — o 2º nível que a pessoa escolhe (Média externa,
 * Votos, Veredito) era decorativo, e o desempate final também.
 *
 * E o tooltip da mesma célula PROMETIA o contrário: "dentro de cada faixa a ordem
 * usa compatibilidade e desempates, não o decimal". Prosa e código afirmando o
 * mesmo fato por critérios diferentes — a classe de erro mais cara deste projeto.
 */

const SRC_RANKING = readFileSync(resolve(process.cwd(), "server/queries/ranking.ts"), "utf8")
const SRC_TABLE = readFileSync(resolve(process.cwd(), "components/ranking/ranking-table.tsx"), "utf8")

/** Corpo do `compareByField`, onde os ramos por campo vivem. */
function compareByFieldBody(): string {
  const start = SRC_RANKING.indexOf("function compareByField")
  expect(start, "compareByField sumiu de server/queries/ranking.ts").toBeGreaterThan(-1)
  // Vai até o comparador final, que é o que consome os níveis.
  const end = SRC_RANKING.indexOf("entries.sort(", start)
  expect(end, "o sort dos níveis sumiu — este teste está lendo o arquivo errado").toBeGreaterThan(start)
  return SRC_RANKING.slice(start, end)
}

describe("a Prioridade ordena pelo número que a tela mostra", () => {
  it("`decision` está na lista de campos arredondados — é o FATO que regride", () => {
    expect(DISPLAY_ROUNDED_SORT_FIELDS).toContain("decision")
    expect(isDisplayRoundedSortField("decision")).toBe(true)
  })

  it("a Nota Prevista, a Recomendada e a Minha nota seguem na lista (não foi uma troca)", () => {
    for (const campo of ["expected_score", "recommended", "user_score"]) {
      expect(DISPLAY_ROUNDED_SORT_FIELDS).toContain(campo)
    }
  })

  /**
   * Deriva os campos da CONSTANTE, nunca de uma lista escrita aqui: campo novo entra
   * na checagem sozinho. Um teste com nomes fixos não acha o próximo que esquecerem.
   */
  it("cada campo da lista compara pelo valor arredondado, e nenhum deles usa o cru", () => {
    const corpo = compareByFieldBody()
    const semArredondar: string[] = []
    const usandoCru: string[] = []

    for (const campo of DISPLAY_ROUNDED_SORT_FIELDS) {
      const marca = `field === "${campo}"`
      const at = corpo.indexOf(marca)
      expect(at, `o ramo de "${campo}" sumiu do compareByField`).toBeGreaterThan(-1)
      // Do ramo até o próximo `if (field ===`, que é onde ele termina.
      const proximo = corpo.indexOf("if (field", at + marca.length)
      const ramo = corpo.slice(at, proximo === -1 ? corpo.length : proximo)
      if (!/displayScore\s*\(/.test(ramo)) semArredondar.push(campo)
      if (/rawScore\s*\(/.test(ramo)) usandoCru.push(campo)
    }

    expect(semArredondar, "campo de nota 0–10 ordenando sem o arredondamento da tela").toEqual([])
    expect(usandoCru, "campo de nota 0–10 ordenando pelo decimal cru — era o bug da Prioridade").toEqual([])
  })

  it("`displayScore` é o dono compartilhado, não uma cópia local do arredondamento", () => {
    // Se alguém reescrever a expressão inline aqui, os dois lados voltam a poder divergir.
    expect(SRC_RANKING).toContain("displaySortValue")
    expect(SRC_RANKING).toMatch(/const\s+displayScore\s*=\s*displaySortValue/)
  })

  /**
   * 🔴 A banda do tier TEM que usar a mesma chave da ordenação (docstring de
   * `buildRankingTiers`): bandar por uma e ordenar por outra faz o mesmo tier
   * reaparecer em vários blocos "Tier N", sem erro nenhum.
   */
  it("a chave da banda de tier deriva do mesmo dono, nos dois campos", () => {
    expect(SRC_TABLE).toContain("displayTierKey")
    // Ancora na CHAMADA (`const tiers = useMemo(`), não na definição de computeTiers —
    // que aparece antes no arquivo e não decide chave nenhuma.
    const at = SRC_TABLE.indexOf("const tiers = useMemo(")
    expect(at, "a chamada que monta os tiers sumiu").toBeGreaterThan(-1)
    const bloco = SRC_TABLE.slice(at, at + 1200)
    expect(bloco).toContain("computeTiers(")
    expect(bloco).toMatch(/displayTierKey\(e\.expectedScore\)/)
    expect(bloco).toMatch(/displayTierKey\(e\.decisionScore\)/)
    // Arredondar à mão de novo é a porta pela qual os dois lados divergem.
    expect(bloco).not.toMatch(/roundToDisplayScore/)
  })
})

describe("o desempate escolhido volta a decidir — caso medido", () => {
  /**
   * Cinco obras REAIS do clone local (2026-08-15) que a tela imprime **todas como
   * "~7,2"**: os crus diferem a partir da 3ª casa (0,004 entre a 1ª e a última).
   * Elas vivem num grupo de **72 obras** com essa mesma nota exibida.
   */
  const OBRAS = [
    { titulo: "Politely Ignore the Villainess", prioridade: 7.248025, mediaExterna: 7.8639 },
    { titulo: "The Tyrant's Obsession with the Dying Empress", prioridade: 7.247, mediaExterna: 7.9063 },
    { titulo: "The Night I Spend With the Mastermind Prince Is My Secret", prioridade: 7.244775, mediaExterna: 7.9876 },
    { titulo: "My Bias Is Obsessed With Me", prioridade: 7.244275, mediaExterna: 7.8536 },
    { titulo: "The Savior Who Strangles Me", prioridade: 7.24375, mediaExterna: 7.9527 },
  ]

  /** A cadeia real: nível 1 (Prioridade desc) → nível 2 (Média externa desc). */
  const ordenar = (chave: (v: number) => number) =>
    [...OBRAS]
      .sort((a, b) => chave(b.prioridade) - chave(a.prioridade) || b.mediaExterna - a.mediaExterna)
      .map((o) => o.titulo)

  it("as cinco aparecem com a MESMA nota — é isso que a pessoa vê", () => {
    expect(new Set(OBRAS.map((o) => o.prioridade.toFixed(1)))).toEqual(new Set(["7.2"]))
    expect(new Set(OBRAS.map((o) => displaySortValue(o.prioridade)))).toEqual(new Set([7.2]))
  })

  it("com a nota exibida, o 2º nível (Média externa) decide a ordem", () => {
    expect(ordenar(displaySortValue)).toEqual([
      "The Night I Spend With the Mastermind Prince Is My Secret", // 7,9876
      "The Savior Who Strangles Me", // 7,9527
      "The Tyrant's Obsession with the Dying Empress", // 7,9063
      "Politely Ignore the Villainess", // 7,8639
      "My Bias Is Obsessed With Me", // 7,8536
    ])
  })

  /** CONTRAPROVA: com o cru, o nível 2 nunca entra e a ordem é a do decimal invisível. */
  it("com o valor cru — o comportamento antigo — o 2º nível é ignorado", () => {
    const comCru = ordenar((v) => v)
    expect(comCru).toEqual([
      "Politely Ignore the Villainess",
      "The Tyrant's Obsession with the Dying Empress",
      "The Night I Spend With the Mastermind Prince Is My Secret",
      "My Bias Is Obsessed With Me",
      "The Savior Who Strangles Me",
    ])
    // A ordem antiga NÃO é a que a média externa produz — a escolha da pessoa era descartada.
    expect(comCru).not.toEqual(ordenar(displaySortValue))
    // E ela é exatamente a ordem do decimal que a tela não mostra.
    expect(comCru).toEqual([...OBRAS].sort((a, b) => b.prioridade - a.prioridade).map((o) => o.titulo))
  })
})

describe("displaySortValue × displayTierKey — ausente cai em lugares diferentes, de propósito", () => {
  it("na ORDENAÇÃO, sem nota vai pro fim em desc", () => {
    expect(displaySortValue(null)).toBe(-Infinity)
    expect(displaySortValue(undefined)).toBe(-Infinity)
  })

  it("na BANDA, sem nota é null — senão viraria um tier de verdade lá embaixo", () => {
    expect(displayTierKey(null)).toBeNull()
    expect(displayTierKey(undefined)).toBeNull()
  })

  it("com valor, os dois devolvem o mesmo número da tela", () => {
    // 8,35 é o caso que o atalho `Math.round(v*10)/10` erra (vira 8,4 e a tela mostra 8,3).
    expect(displaySortValue(8.35)).toBe(8.3)
    expect(displayTierKey(8.35)).toBe(8.3)
    expect((8.35).toFixed(1)).toBe("8.3")
  })
})
