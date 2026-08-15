import { describe, it, expect } from "vitest"
import {
  netNameOverlap,
  criterionAlignment,
  weightedTagOverlap,
} from "@/lib/ai-recommendation/personal-fit"
import type { ProfileTag, TasteProfilePayload } from "@/lib/ai-recommendation/types"

/**
 * As três funções VIVAS de `personal-fit.ts`.
 *
 * 🔴 **Até 15/08/2026 este arquivo testava `computePersonalFit` — e SÓ ela.** Ou seja:
 * a suíte cobria a função morta e deixava sem teste direto justamente a que calcula o
 * Alinhamento exibido (`netNameOverlap`). Ao apagar a morta, a saída não podia ser
 * apagar o arquivo: dois dos seis casos eram a única cobertura de `criterionAlignment`,
 * que está viva como feature do Ridge da Nota Prevista. Foram repontados.
 *
 * Quem consome o quê hoje (`server/actions/calculations.ts`):
 *   netNameOverlap     → bloco 5, vira `personal_fit`/`tag_overlap_net` (o Alinhamento)
 *   weightedTagOverlap → bloco 2b, features `lovedTagOverlap`/`avoidedTagOverlap`
 *   criterionAlignment → bloco 2b, feature `criterionFitScore`
 */

const t = (name: string, strength: number, group: string | null = "tema"): ProfileTag => ({
  name,
  group,
  strength,
})

const obra = (...nomes: string[]) => nomes.map((name) => ({ name, group: "tema" }))

describe("netNameOverlap — o número que vira o Alinhamento", () => {
  it("sem loved nem avoided devolve null — 'sem sinal' não é 'overlap zero'", () => {
    expect(netNameOverlap(obra("Regression"), [], [])).toBeNull()
  })

  it("soma a força das amadas presentes", () => {
    const r = netNameOverlap(obra("Regression", "Villainess"), [t("Regression", 0.8), t("Villainess", 0.5)], [])
    expect(r).toBeCloseTo(1.3, 5)
  })

  it("evitada pesa 1,5× — e o resultado pode ficar NEGATIVO", () => {
    const r = netNameOverlap(obra("Gore"), [], [t("Gore", 1)])
    expect(r).toBeCloseTo(-1.5, 5)
  })

  it("casa por NOME, ignorando o grupo", () => {
    // A régua venceu por medição (bootstrap 27/06/2026: ~0,544 contra ~0,514 do
    // `group::name`). Se um dia alguém "consertar" isto casando o grupo junto, a tag
    // deixa de contar e o Alinhamento cai sem nada acusar.
    // ⚠️ A assinatura já pede só `{ name }` — o grupo vai aqui de propósito, como as
    // work_tags reais chegam, pra o teste exercitar a mesma forma de dado.
    const tagsDaObra = [{ name: "Regression", group: "OUTRO GRUPO" }]
    expect(netNameOverlap(tagsDaObra, [t("Regression", 0.7, "tema")], [])).toBeCloseTo(0.7, 5)
  })

  it("é insensível a caixa e espaço em volta", () => {
    const tagsDaObra = [{ name: "  REGRESSION ", group: null }]
    expect(netNameOverlap(tagsDaObra, [t("regression", 0.4, null)], [])).toBeCloseTo(0.4, 5)
  })

  it("NÃO tem denominador — mais tags só podem AUMENTAR o valor", () => {
    // É a propriedade que faz obra sub-tagueada ter Alinhamento estruturalmente baixo
    // (medido nas 988 obras: percentil médio 8,5 com ≤10 tags contra 80,8 com 100+).
    // Normalizar aqui foi testado em 03/07/2026 e PIORA — ver o docstring do módulo.
    const loved = [t("A", 0.5), t("B", 0.5), t("C", 0.5)]
    const poucas = netNameOverlap(obra("A"), loved, [])!
    const muitas = netNameOverlap(obra("A", "B", "C"), loved, [])!
    expect(muitas).toBeGreaterThan(poucas)
  })
})

describe("weightedTagOverlap — feature do Ridge", () => {
  it("perfil vazio devolve null; sem interseção devolve 0", () => {
    expect(weightedTagOverlap(obra("A"), [])).toBeNull()
    expect(weightedTagOverlap(obra("A"), [t("B", 1)])).toBe(0)
  })

  it("aqui o grupo IMPORTA — casa por `group::name`, diferente do netName", () => {
    expect(weightedTagOverlap([{ name: "A", group: "x" }], [t("A", 1, "y")])).toBe(0)
    expect(weightedTagOverlap([{ name: "A", group: "x" }], [t("A", 1, "x")])).toBe(1)
  })
})

describe("criterionAlignment — feature do Ridge, NÃO entra no Alinhamento", () => {
  const prefs = {
    romance: { ideal_min: 7, ideal_max: 9, weight: 1, note: null },
  } as unknown as TasteProfilePayload["criterion_preferences"]

  it("sem preferências devolve null", () => {
    expect(criterionAlignment({ romance: 8 } as never, {})).toBeNull()
  })

  it("dentro da faixa ideal dá 1", () => {
    expect(criterionAlignment({ romance: 8 } as never, prefs)).toBeCloseTo(1, 5)
  })

  it("cai linearmente com a distância da borda, zerando a 5 pontos", () => {
    // Distância normalizada por 5 (metade da escala).
    expect(criterionAlignment({ romance: 6.5 } as never, prefs)).toBeCloseTo(0.9, 5)
    expect(criterionAlignment({ romance: 2 } as never, prefs)).toBeCloseTo(0, 5)
    expect(criterionAlignment({ romance: 0 } as never, prefs)).toBeCloseTo(0, 5)
  })

  it("ignora critério sem score na obra em vez de contá-lo como zero", () => {
    expect(criterionAlignment({} as never, prefs)).toBeNull()
  })
})
