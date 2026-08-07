import { describe, it, expect } from "vitest"

import { ARCHETYPE_LABEL, ARCHETYPE_MEANING, ARCHETYPE_ORDER } from "@/lib/ranking/tier-composition"
import { ARCHETYPE_STYLE, CORNER_ARCHETYPE } from "@/lib/ranking/archetype-style"
import { classifyArchetypeByPercentile } from "@/lib/calculations/forces"

/**
 * O vocabulário dos 4 arquétipos é COMPARTILHADO por três superfícies desde
 * 2026-08-06: o divisor de tier da view Lista, as prateleiras dos Cards e os
 * cantos da Bússola. Antes disso a Bússola tinha a própria cópia ("Aposta
 * segura", "Teu nicho"…) e as duas divergiam.
 *
 * Estes testes existem porque a divergência anterior era INVISÍVEL — nada
 * quebrava, as duas telas só diziam coisas diferentes sobre a mesma obra.
 */
describe("vocabulário dos arquétipos", () => {
  it("tem rótulo e significado para os quatro, sem sobra nem falta", () => {
    expect(ARCHETYPE_ORDER).toHaveLength(4)
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPE_LABEL[a]).toBeTruthy()
      expect(ARCHETYPE_MEANING[a]).toBeTruthy()
      expect(ARCHETYPE_STYLE[a]).toBeTruthy()
    }
    expect(Object.keys(ARCHETYPE_LABEL).sort()).toEqual([...ARCHETYPE_ORDER].sort())
    expect(Object.keys(ARCHETYPE_MEANING).sort()).toEqual([...ARCHETYPE_ORDER].sort())
    expect(Object.keys(ARCHETYPE_STYLE).sort()).toEqual([...ARCHETYPE_ORDER].sort())
  })

  it("mantém os rótulos em MINÚSCULA — eles também entram em frase no divisor de tier", () => {
    // "5 vale o risco · 3 só teu gosto". Capitalizar na fonte quebraria essa
    // leitura; onde é título, quem capitaliza é o CSS (`first-letter:uppercase`).
    for (const a of ARCHETYPE_ORDER) {
      const first = ARCHETYPE_LABEL[a][0]
      expect(first).toBe(first.toLowerCase())
    }
  })

  /**
   * 🔴 O teste que justifica a existência deste arquivo.
   *
   * A redação anterior da Bússola afirmava julgamento da crítica — "você curte,
   * crítica não" para `niche`, "pouca chance e aclamação" para `skip`. Medido no
   * acervo em 2026-08-06: das 223 obras em `niche`, ZERO são mal avaliadas pelo
   * limiar absoluto do próprio código; das 211 em `skip`, uma. O corte é a MEDIANA
   * do conjunto exibido, e o catálogo é curado (mediana da Avaliação = 7,9/10).
   *
   * As frases têm que comparar os dois sinais ENTRE SI, nunca sentenciar sobre um.
   */
  it("não afirma que a crítica reprovou nada", () => {
    const proibido = /crítica não|pouca aclamação|mal avaliada|crítica reprova/i
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPE_MEANING[a]).not.toMatch(proibido)
    }
    // e as duas frases de discordância dizem QUAL lado aprova mais
    expect(ARCHETYPE_MEANING.upside).toMatch(/crítica.*mais/i)
    expect(ARCHETYPE_MEANING.niche).toMatch(/perfil.*mais/i)
  })

  it("liga cada canto do plano ao arquétipo que a classificação produz ali", () => {
    // Chance no eixo X, Avaliação no Y. Um canto que anunciasse um arquétipo e
    // recebesse pontos de outro seria um mapa mentindo sobre a própria legenda.
    const alto = 75
    const baixo = 25
    expect(classifyArchetypeByPercentile(alto, alto)).toBe(CORNER_ARCHETYPE.tr)
    expect(classifyArchetypeByPercentile(baixo, alto)).toBe(CORNER_ARCHETYPE.tl)
    expect(classifyArchetypeByPercentile(alto, baixo)).toBe(CORNER_ARCHETYPE.br)
    expect(classifyArchetypeByPercentile(baixo, baixo)).toBe(CORNER_ARCHETYPE.bl)
  })

  it("dá uma cor distinta a cada arquétipo", () => {
    const dots = ARCHETYPE_ORDER.map((a) => ARCHETYPE_STYLE[a].dot)
    expect(new Set(dots).size).toBe(4)
  })
})
