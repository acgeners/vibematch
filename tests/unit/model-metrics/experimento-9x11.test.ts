import { describe, expect, it } from "vitest"
import {
  OFFICIAL_CRITERIA,
  EXPERIMENTAL_CRITERIA,
  EXPERIMENTAL_EXTRA,
  DEFAULT_SEED,
  MIN_TRAIN,
  selecionarCoorte,
  medirCobertura,
  permutarExtras,
  rodarAnalisePrincipal,
  rodarAnaliseSecundaria,
  spearman,
  overlapTopN,
  temCriterioReal,
  type ExperimentWork,
} from "@/lib/model-metrics/criteria-experiment"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import type { ExpectedScoreInput } from "@/lib/calculations/expected"

/**
 * O harness 9 × 11. Tudo determinístico: mesma fixture, mesmos números.
 */

/** Obra sintética. `extras` decide se `setting_era`/`angst` existem e com que `source`. */
function obra(
  i: number,
  extras: { setting_era?: string | null; angst?: string | null } = {
    setting_era: "ai_accepted", angst: "ai_accepted",
  },
): ExperimentWork {
  const categoryScores: Record<string, number> = {}
  const sources: Record<string, string | undefined> = {}
  OFFICIAL_CRITERIA.forEach((s, k) => {
    categoryScores[s] = 2 + ((i * (k + 3)) % 8)
    // `fantasy` entra como cópia do legado de propósito: o harness TEM de aceitá-la.
    sources[s] = s === "fantasy" ? "legacy_split_copy" : "ai_accepted"
  })
  for (const s of EXPERIMENTAL_EXTRA) {
    const src = extras[s as keyof typeof extras]
    if (src != null) {
      categoryScores[s] = (i * 2.7) % 10
      sources[s] = src
    }
  }
  const input = {
    categoryScores,
    iaEvalNormalized: 5 + (i % 5) * 0.3,
    platformAvg: 6.5 + (i % 6) * 0.25,
    totalVotes: 80 * (i + 1),
    totalChapters: 40 + i,
    synopsisQuality: null,
    observationAdjustment: 0,
    publicationStatus: "Completed",
    lovedTagOverlap: 0.1 + (i % 4) * 0.05,
    avoidedTagOverlap: 0.05,
    criterionFitScore: 0.4 + (i % 3) * 0.1,
    releaseAge: 2 + (i % 7),
    runLength: null,
    origin: "ko",
    postScores: {},
  } as unknown as ExpectedScoreInput
  return { id: `w${String(i).padStart(3, "0")}`, userScore: 5 + ((i * 3) % 10) * 0.4, input, sources }
}

const coorteCheia = (n: number) => Array.from({ length: n }, (_, i) => obra(i))

describe("as duas listas", () => {
  it("oficial tem exatamente 9 e é a lista do ranking real", () => {
    expect(OFFICIAL_CRITERIA).toHaveLength(9)
    expect([...OFFICIAL_CRITERIA]).toEqual([...SCORING_CRITERION_SLUGS])
  })

  it("experimental tem exatamente 11", () => {
    expect(EXPERIMENTAL_CRITERIA).toHaveLength(11)
  })

  /** 🔴 O experimento não pode mexer em mais nada: a diferença tem de ser só os dois. */
  it("o experimental acrescenta SOMENTE setting_era e angst, na ordem", () => {
    expect([...EXPERIMENTAL_CRITERIA].slice(0, 9)).toEqual([...OFFICIAL_CRITERIA])
    expect([...EXPERIMENTAL_CRITERIA].slice(9)).toEqual(["setting_era", "angst"])
    expect([...EXPERIMENTAL_EXTRA]).toEqual(["setting_era", "angst"])
  })

  it("as assinaturas diferem — é o que distingue duas execuções", () => {
    expect(OFFICIAL_CRITERIA.join(",")).not.toBe(EXPERIMENTAL_CRITERIA.join(","))
  })
})

describe("a coorte principal", () => {
  it("obra sem setting_era sai da coorte", () => {
    const ws = [...coorteCheia(5), obra(9, { setting_era: null, angst: "ai_accepted" })]
    expect(selecionarCoorte(ws)).toHaveLength(5)
  })

  it("obra sem angst sai da coorte", () => {
    const ws = [...coorteCheia(5), obra(9, { setting_era: "ai_accepted", angst: null })]
    expect(selecionarCoorte(ws)).toHaveLength(5)
  })

  /**
   * 🔴 A assimetria é deliberada: `fantasy` vale como `legacy_split_copy` (é a nota que a obra
   * TEM e que o ranking usa hoje), mas os dois novos não — eles não têm seed, então uma cópia
   * ali seria valor sem origem no braço que decide o resultado.
   */
  it("fantasy vale como legacy_split_copy; setting_era e angst NÃO", () => {
    const w = obra(1)
    expect(temCriterioReal(w, "fantasy")).toBe(true)
    const copiado = obra(2, { setting_era: "legacy_split_copy", angst: "ai_accepted" })
    expect(temCriterioReal(copiado, "setting_era")).toBe(false)
    expect(selecionarCoorte([copiado])).toHaveLength(0)
  })

  it("a cobertura conta cada eixo e não divide por zero", () => {
    const ws = [
      ...coorteCheia(4),
      obra(7, { setting_era: "ai_accepted", angst: null }),
      obra(8, { setting_era: null, angst: null }),
    ]
    const c = medirCobertura(ws)
    expect(c.rotuladas).toBe(6)
    expect(c.comSettingEra).toBe(5)
    expect(c.comAngst).toBe(4)
    expect(c.comAmbos).toBe(4)
    expect(c.fracaoComOsOnze).toBeCloseTo(4 / 6, 10)
    // sem rotuladas não é "0% de cobertura", é "não há o que medir"
    expect(medirCobertura([]).fracaoComOsOnze).toBeNull()
  })
})

describe("a análise principal compara os dois braços NA MESMA coorte", () => {
  const ws = [...coorteCheia(40), obra(77, { setting_era: null, angst: null })]
  const r = rodarAnalisePrincipal(ws, { permutacoes: 10, seed: DEFAULT_SEED })

  it("o N é o da coorte, não o das rotuladas", () => {
    expect(r.n).toBe(40)
    expect(ws).toHaveLength(41)
  })

  it("os dois braços existem e declaram a própria lista", () => {
    expect(r.oficial?.criterios).toHaveLength(9)
    expect(r.experimental?.criterios).toHaveLength(11)
    expect(r.oficial?.assinatura).not.toBe(r.experimental?.assinatura)
  })

  it("o delta é a diferença dos dois cvMAE, na mesma direção", () => {
    expect(r.deltaCvMae).toBeCloseTo((r.experimental!.cvMae as number) - (r.oficial!.cvMae as number), 12)
  })

  /** 🔴 top-N sobre populações diferentes esconderia a diferença de cobertura. */
  it("o top-N é recortado pela população e declara o efetivo", () => {
    expect(r.top10?.efetivo).toBe(10)
    expect(r.top50?.pedido).toBe(50)
    expect(r.top50?.efetivo).toBe(40) // a coorte tem 40, não 50
    expect(r.top50!.comum).toBeLessThanOrEqual(40)
  })

  it("há um coeficiente por critério, dos dois lados", () => {
    expect(r.oficial?.coeficientes).toHaveLength(9)
    expect(r.experimental?.coeficientes).toHaveLength(11)
    expect(r.experimental?.coeficientes.map((c) => c.slug)).toEqual([...EXPERIMENTAL_CRITERIA])
  })

  it("nenhuma métrica sai NaN ou Infinity", () => {
    const nums = [
      r.oficial?.cvMae, r.experimental?.cvMae, r.deltaCvMae,
      r.oficial?.rhoComRotulo, r.experimental?.rhoComRotulo, r.spearmanEntreOsDois,
      r.nulo?.media, r.nulo?.desvio, r.nulo?.z, r.nulo?.p,
      ...(r.experimental?.coeficientes.map((c) => c.coef) ?? []),
    ]
    for (const v of nums) {
      if (v == null) continue
      expect(Number.isFinite(v), `valor não finito: ${v}`).toBe(true)
    }
  })
})

describe("N pequeno degrada sem NaN", () => {
  it("abaixo do mínimo do Ridge devolve nulls, não números inventados", () => {
    const r = rodarAnalisePrincipal(coorteCheia(MIN_TRAIN - 1), { permutacoes: 5 })
    expect(r.n).toBe(MIN_TRAIN - 1)
    expect(r.oficial).toBeNull()
    expect(r.experimental).toBeNull()
    expect(r.deltaCvMae).toBeNull()
    expect(r.nulo).toBeNull()
    expect(r.amostraPequena).toBe(true)
  })

  it("coorte vazia não quebra", () => {
    const r = rodarAnalisePrincipal([], { permutacoes: 5 })
    expect(r.n).toBe(0)
    expect(r.deltaCvMae).toBeNull()
  })

  it("spearman devolve null (não NaN) quando um lado é constante", () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull()
    expect(spearman([1], [1])).toBeNull()
  })

  it("overlapTopN com população vazia não divide por nada", () => {
    expect(overlapTopN([], [], [], 10)).toEqual({ pedido: 10, efetivo: 0, comum: 0 })
  })
})

describe("a permutação é determinística", () => {
  const coorte = coorteCheia(30)

  it("mesma seed ⇒ mesma permutação", () => {
    const a = permutarExtras(coorte, 123).map((w) => w.input.categoryScores.setting_era)
    const b = permutarExtras(coorte, 123).map((w) => w.input.categoryScores.setting_era)
    expect(a).toEqual(b)
  })

  it("seed diferente ⇒ permutação diferente", () => {
    const a = permutarExtras(coorte, 123).map((w) => w.input.categoryScores.setting_era)
    const b = permutarExtras(coorte, 999).map((w) => w.input.categoryScores.setting_era)
    expect(a).not.toEqual(b)
  })

  /** 🔴 O nulo certo PRESERVA a distribuição e destrói só a associação com a obra. */
  it("permuta os mesmos valores, sem inventar nenhum", () => {
    const antes = [...coorte.map((w) => w.input.categoryScores.angst as number)].sort((x, y) => x - y)
    const depois = [...permutarExtras(coorte, 7).map((w) => w.input.categoryScores.angst as number)]
      .sort((x, y) => x - y)
    expect(depois).toEqual(antes)
  })

  it("não toca nos 9 oficiais", () => {
    const p = permutarExtras(coorte, 7)
    coorte.forEach((w, i) => {
      for (const s of OFFICIAL_CRITERIA) {
        expect(p[i].input.categoryScores[s as never]).toBe(w.input.categoryScores[s as never])
      }
    })
  })

  it("a análise inteira é reprodutível com a mesma seed", () => {
    const a = rodarAnalisePrincipal(coorteCheia(40), { permutacoes: 8, seed: 42 })
    const b = rodarAnalisePrincipal(coorteCheia(40), { permutacoes: 8, seed: 42 })
    expect(a.nulo).toEqual(b.nulo)
    expect(a.deltaCvMae).toBe(b.deltaCvMae)
  })
})

describe("a análise secundária é outra pergunta", () => {
  const ws = [
    ...coorteCheia(25),
    ...Array.from({ length: 15 }, (_, i) => obra(100 + i, { setting_era: null, angst: null })),
  ]
  const s = rodarAnaliseSecundaria(ws)

  /** Ela roda sobre TODAS as rotuladas e deixa a imputação preencher o que falta. */
  it("usa todas as rotuladas, não só a coorte", () => {
    expect(s.n).toBe(40)
    expect(selecionarCoorte(ws)).toHaveLength(25)
  })

  it("reporta a cobertura junto, para o número não ser lido sozinho", () => {
    expect(s.cobertura.comAmbos).toBe(25)
    expect(s.cobertura.rotuladas).toBe(40)
  })

  it("produz os dois MAE sem NaN mesmo com 15 obras imputadas", () => {
    expect(Number.isFinite(s.maeOficial as number)).toBe(true)
    expect(Number.isFinite(s.maeExperimental as number)).toBe(true)
    expect(Number.isFinite(s.delta as number)).toBe(true)
  })
})
