import { describe, it, expect } from "vitest"
import {
  ART_FEATURE_NAMES,
  ART_SIGNAL_VERSION,
  ART_TAG_SLUGS,
  artFeatureVector,
  extractArtSignal,
  hasArtEvidence,
  isArtSignalStale,
  parseArtSignal,
  type ArtSignal,
} from "@/lib/art/signal"
import {
  ART_MIN_TRAIN,
  artBandFromPercentile,
  artOutOfFoldEstimates,
  computeArtForCatalog,
  computeArtPercentiles,
  trainArtPredictor,
  type ArtCatalogInput,
  type ArtSample,
} from "@/lib/art/model"

const sinalVazio = (over: Partial<ArtSignal> = {}): ArtSignal => ({
  v: ART_SIGNAL_VERSION,
  digestPositive: 0,
  digestNegative: 0,
  reviewCount: 0,
  artMentions: 0,
  lexPositive: 0,
  lexNegative: 0,
  ...over,
})

describe("extractArtSignal", () => {
  it("digest corrompido é tratado como ausente, não estoura", () => {
    // A obra ainda tem reviews a oferecer — abortar apagaria o sinal inteiro por um JSON quebrado.
    const s = extractArtSignal({
      reviewDigest: "{isto não é json",
      reviewTexts: ["the art is gorgeous"],
    })
    expect(s.digestPositive).toBe(0)
    expect(s.lexPositive).toBeGreaterThan(0)
  })

  it("conta só os traços do eixo de ARTE, por polaridade", () => {
    const s = extractArtSignal({
      reviewDigest: {
        salient_traits: [
          { axis: "arte", polarity: "positive", trait: "traço detalhado" },
          { axis: "Arte / estilo", polarity: "negative", trait: "anatomia estranha" },
          { axis: "ritmo", polarity: "positive", trait: "avança rápido" },
        ],
      },
      reviewTexts: [],
    })
    expect(s.digestPositive).toBe(1)
    expect(s.digestNegative).toBe(1)
  })

  it("o léxico só vale DENTRO da janela em torno da menção a arte", () => {
    // "gorgeous" a ~600 chars da palavra "art" está falando de outra coisa (a janela é ±140).
    const longe = "art is fine." + " x".repeat(400) + " gorgeous protagonist"
    const perto = "the art is gorgeous"
    const sLonge = extractArtSignal({ reviewDigest: null, reviewTexts: [longe] })
    const sPerto = extractArtSignal({ reviewDigest: null, reviewTexts: [perto] })
    expect(sPerto.lexPositive).toBeGreaterThan(0)
    expect(sLonge.lexPositive).toBe(0)
  })

  it("conta reviews e menções separadamente", () => {
    const s = extractArtSignal({
      reviewDigest: null,
      reviewTexts: ["the art and the artwork", "nada sobre isso", "arte linda"],
    })
    expect(s.reviewCount).toBe(3)
    expect(s.artMentions).toBe(3)
  })
})

describe("artFeatureVector", () => {
  it("tem exatamente um nome por posição", () => {
    const v = artFeatureVector(sinalVazio(), [])
    expect(v).toHaveLength(ART_FEATURE_NAMES.length)
    expect(v.every(Number.isFinite)).toBe(true)
  })

  it("as tags entram por SLUG e vêm de fora do sinal", () => {
    // Elas não moram no sinal persistido: guardá-las obrigaria a reler o digest a cada
    // mudança de tag. Ver o ⚠️ no topo de signal.ts.
    const semTag = artFeatureVector(sinalVazio(), [])
    const comTag = artFeatureVector(sinalVazio(), [ART_TAG_SLUGS[0]])
    expect(comTag).not.toEqual(semTag)
    expect(comTag[ART_FEATURE_NAMES.indexOf(ART_TAG_SLUGS[0])]).toBe(1)
  })

  it("não divide por zero quando a obra não tem review", () => {
    const v = artFeatureVector(sinalVazio({ artMentions: 0, reviewCount: 0 }), [])
    expect(v.every(Number.isFinite)).toBe(true)
  })
})

describe("hasArtEvidence", () => {
  it("obra sem nenhum sinal não recebe estimativa", () => {
    expect(hasArtEvidence(sinalVazio(), [])).toBe(false)
    expect(hasArtEvidence(null, [ART_TAG_SLUGS[0]])).toBe(false)
  })

  it("uma tag de arte sozinha já é evidência", () => {
    expect(hasArtEvidence(sinalVazio(), [ART_TAG_SLUGS[0]])).toBe(true)
  })

  it("menção em review sozinha já é evidência", () => {
    expect(hasArtEvidence(sinalVazio({ artMentions: 2 }), [])).toBe(true)
  })
})

describe("parseArtSignal / isArtSignalStale", () => {
  it("jsonb malformado vira null em vez de sinal com buraco", () => {
    expect(parseArtSignal(null)).toBeNull()
    expect(parseArtSignal({ v: 1 })).toBeNull()
    expect(parseArtSignal({ ...sinalVazio(), lexPositive: "3" })).toBeNull()
  })

  it("sinal de versão anterior é stale — régua antiga não pode misturar com a nova", () => {
    expect(isArtSignalStale(null)).toBe(true)
    expect(isArtSignalStale(sinalVazio({ v: ART_SIGNAL_VERSION - 1 }))).toBe(true)
    expect(isArtSignalStale(sinalVazio())).toBe(false)
  })
})

describe("computeArtPercentiles", () => {
  it("null entra e sai null — sem estimativa não tem posição", () => {
    const p = computeArtPercentiles([8, null, 6, null, 7])
    expect(p[1]).toBeNull()
    expect(p[3]).toBeNull()
    expect(p.filter((v) => v != null)).toHaveLength(3)
  })

  it("empatados recebem o MESMO percentil (midrank)", () => {
    const p = computeArtPercentiles([5, 5, 9])
    expect(p[0]).toBe(p[1])
    expect(p[2]).toBeGreaterThan(p[0] as number)
  })

  it("ordena crescente e fica em (0, 1]", () => {
    const p = computeArtPercentiles([1, 2, 3, 4]) as number[]
    expect(p[0]).toBeLessThan(p[3])
    expect(Math.min(...p)).toBeGreaterThan(0)
    expect(Math.max(...p)).toBeLessThanOrEqual(1)
  })
})

describe("artBandFromPercentile", () => {
  it("sem estimativa é um TERCEIRO estado, nunca 'media'", () => {
    expect(artBandFromPercentile(null)).toBeNull()
    expect(artBandFromPercentile(undefined)).toBeNull()
    expect(artBandFromPercentile(NaN)).toBeNull()
  })

  it("corta em 20/60/20", () => {
    expect(artBandFromPercentile(0.05)).toBe("fraca")
    expect(artBandFromPercentile(0.2)).toBe("fraca")
    expect(artBandFromPercentile(0.21)).toBe("media")
    expect(artBandFromPercentile(0.8)).toBe("media")
    expect(artBandFromPercentile(0.81)).toBe("forte")
  })
})

describe("modelo de arte", () => {
  const amostras = (n: number, label: (i: number) => number): ArtSample[] =>
    Array.from({ length: n }, (_, i) => ({
      features: new Array(ART_FEATURE_NAMES.length).fill(0),
      label: label(i),
    }))

  it("abaixo do piso de treino não há estimativa — null, nunca a média", () => {
    const poucas = amostras(ART_MIN_TRAIN - 1, () => 8)
    expect(trainArtPredictor(poucas)).toBeNull()
    expect(artOutOfFoldEstimates(poucas)).toBeNull()
  })

  it("a estimativa OOF de uma obra NÃO usa o rótulo dela", () => {
    // Features idênticas ⇒ o modelo só pode prever a média do fold de treino. Com todos os
    // rótulos em 2 e UM em 10, o out-of-fold do discrepante tem que cair perto de 2: se ele
    // vier perto de 10, a obra entrou no próprio treino. É exatamente o vazamento que
    // inflaria a estimativa justo onde existe verdade para conferir.
    const n = ART_MIN_TRAIN + 10
    const dados = amostras(n, (i) => (i === 0 ? 10 : 2))
    const oof = artOutOfFoldEstimates(dados)
    expect(oof).not.toBeNull()
    expect(oof![0]).toBeLessThan(3)

    // O caminho in-sample, por contraste, puxa o próprio rótulo para dentro da média.
    const insample = trainArtPredictor(dados)!.predict([dados[0].features])[0]
    expect(insample).toBeGreaterThan(oof![0])
  })

  it("devolve uma estimativa finita por obra, na escala do rótulo", () => {
    const dados = amostras(ART_MIN_TRAIN + 10, (i) => 2 + (i % 5))
    const oof = artOutOfFoldEstimates(dados)!
    expect(oof).toHaveLength(dados.length)
    expect(oof.every((v) => Number.isFinite(v) && v >= 0 && v <= 10)).toBe(true)
  })
})

describe("computeArtForCatalog", () => {
  /** Obra com evidência: uma tag de arte basta (`hasArtEvidence`). */
  const obra = (id: string, label: number | null, comEvidencia = true): ArtCatalogInput => ({
    id,
    signal: sinalVazio({ artMentions: comEvidencia ? 3 : 0, lexPositive: comEvidencia ? 1 : 0 }),
    tagSlugs: comEvidencia ? [ART_TAG_SLUGS[0]] : [],
    label,
  })

  const catalogo = (nRot: number, nSem: number): ArtCatalogInput[] => [
    ...Array.from({ length: nRot }, (_, i) => obra(`rot-${i}`, 2 + (i % 5))),
    ...Array.from({ length: nSem }, (_, i) => obra(`sem-${i}`, null)),
  ]

  it("abaixo do piso de rótulos, o catálogo INTEIRO fica sem estimativa", () => {
    // Nem meia feature: o desligamento é total, senão parte do catálogo seria filtrável e
    // parte não, e o filtro devolveria um recorte que ninguém pediu.
    const out = computeArtForCatalog(catalogo(ART_MIN_TRAIN - 1, 20))
    expect(out.size).toBe(ART_MIN_TRAIN - 1 + 20)
    expect([...out.values()].every((v) => v.estimate === null && v.percentile === null)).toBe(true)
  })

  it("obra sem evidência fica null mesmo com o modelo treinado", () => {
    const inputs = [...catalogo(ART_MIN_TRAIN + 5, 5), obra("vazia", null, false)]
    const out = computeArtForCatalog(inputs)
    expect(out.get("vazia")).toEqual({ estimate: null, percentile: null })
    expect(out.get("sem-0")!.estimate).not.toBeNull()
  })

  it("obra sem `art_signal` (antes da semente) fica null, nunca na média", () => {
    const inputs = [...catalogo(ART_MIN_TRAIN + 5, 5), { id: "nova", signal: null, tagSlugs: [], label: null }]
    const out = computeArtForCatalog(inputs)
    expect(out.get("nova")).toEqual({ estimate: null, percentile: null })
  })

  it("a obra ROTULADA recebe a estimativa out-of-fold, não a in-sample", () => {
    // Mesmo desenho do teste de vazamento acima: features idênticas ⇒ só a média do fold de
    // treino. O discrepante tem que cair perto de 2; perto de 10 significa que ele entrou no
    // próprio treino, que é como a estimativa ficaria boa demais justo onde há verdade.
    const inputs: ArtCatalogInput[] = Array.from({ length: ART_MIN_TRAIN + 10 }, (_, i) =>
      obra(`w-${i}`, i === 0 ? 10 : 2),
    )
    const out = computeArtForCatalog(inputs)
    expect(out.get("w-0")!.estimate).toBeLessThan(3)
  })

  it("percentil cobre só quem tem estimativa, e ordena junto com ela", () => {
    const out = computeArtForCatalog(catalogo(ART_MIN_TRAIN + 5, 5))
    const comEst = [...out.values()].filter((v) => v.estimate != null)
    expect(comEst.every((v) => v.percentile != null)).toBe(true)
    const ordenado = [...comEst].sort((a, b) => (a.estimate as number) - (b.estimate as number))
    for (let i = 1; i < ordenado.length; i++) {
      expect(ordenado[i].percentile as number).toBeGreaterThanOrEqual(ordenado[i - 1].percentile as number)
    }
  })
})
