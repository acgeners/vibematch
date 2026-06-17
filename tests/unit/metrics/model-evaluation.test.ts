import { describe, it, expect } from "vitest"
import {
  MIN_PROSPECTIVE_SAMPLE_SIZE,
  parseModelEvaluationMetrics,
  selectPrimaryModelMetric,
  calculateRelativeErrorReduction,
  describeMetricSource,
  type ModelEvaluationMetrics,
} from "@/lib/metrics/model-evaluation"

const EMPTY: ModelEvaluationMetrics = {
  trainMae: null,
  crossValidationMae: null,
  prospectiveMae: null,
  baselineMae: null,
  sampleSize: null,
  foldCount: null,
  evaluatedAt: null,
  prospectiveSampleSize: null,
  prospectiveEvaluatedAt: null,
}

describe("parseModelEvaluationMetrics", () => {
  it("normaliza números válidos vindos como string (numeric do Postgres)", () => {
    const m = parseModelEvaluationMetrics({
      trainMae: "0.545",
      crossValidationMae: "0.579",
      baselineMae: "0.749",
      sampleSize: "191",
      foldCount: "5",
      evaluatedAt: "2026-06-17T10:00:00.000Z",
    })
    expect(m.trainMae).toBe(0.545)
    expect(m.crossValidationMae).toBe(0.579)
    expect(m.baselineMae).toBe(0.749)
    expect(m.sampleSize).toBe(191)
    expect(m.foldCount).toBe(5)
    expect(m.evaluatedAt).toBe("2026-06-17T10:00:00.000Z")
    expect(m.prospectiveMae).toBeNull()
  })

  it("NÃO transforma 0, string vazia, NaN ou negativo em MAE legítima", () => {
    const m = parseModelEvaluationMetrics({
      trainMae: 0,
      crossValidationMae: "",
      prospectiveMae: Number.NaN,
      baselineMae: -1,
    })
    expect(m.trainMae).toBeNull()
    expect(m.crossValidationMae).toBeNull()
    expect(m.prospectiveMae).toBeNull()
    expect(m.baselineMae).toBeNull()
  })

  it("chaves ausentes e entrada não-objeto viram tudo null", () => {
    expect(parseModelEvaluationMetrics({})).toEqual(EMPTY)
    expect(parseModelEvaluationMetrics(null)).toEqual(EMPTY)
    expect(parseModelEvaluationMetrics("x")).toEqual(EMPTY)
  })

  it("sampleSize aceita 0; foldCount 0 e timestamp inválido viram null", () => {
    const m = parseModelEvaluationMetrics({
      sampleSize: 0,
      foldCount: 0,
      evaluatedAt: "not-a-date",
      prospectiveSampleSize: "12",
    })
    expect(m.sampleSize).toBe(0)
    expect(m.foldCount).toBeNull()
    expect(m.evaluatedAt).toBeNull()
    expect(m.prospectiveSampleSize).toBe(12)
  })

  it("Infinity é rejeitado", () => {
    const m = parseModelEvaluationMetrics({ crossValidationMae: Infinity })
    expect(m.crossValidationMae).toBeNull()
  })
})

describe("selectPrimaryModelMetric", () => {
  it("prospectiva com amostra suficiente vence a CV", () => {
    const r = selectPrimaryModelMetric({
      ...EMPTY,
      crossValidationMae: 0.58,
      sampleSize: 191,
      prospectiveMae: 0.61,
      prospectiveSampleSize: MIN_PROSPECTIVE_SAMPLE_SIZE,
      prospectiveEvaluatedAt: "2026-06-17T00:00:00.000Z",
    })
    expect(r.source).toBe("prospective")
    expect(r.mae).toBe(0.61)
    expect(r.sampleSize).toBe(MIN_PROSPECTIVE_SAMPLE_SIZE)
    expect(r.evaluatedAt).toBe("2026-06-17T00:00:00.000Z")
  })

  it("prospectiva abaixo da amostra mínima cai pra CV", () => {
    const r = selectPrimaryModelMetric({
      ...EMPTY,
      crossValidationMae: 0.58,
      sampleSize: 191,
      evaluatedAt: "2026-06-10T00:00:00.000Z",
      prospectiveMae: 0.61,
      prospectiveSampleSize: MIN_PROSPECTIVE_SAMPLE_SIZE - 1,
    })
    expect(r.source).toBe("cross-validation")
    expect(r.mae).toBe(0.58)
    expect(r.sampleSize).toBe(191)
    expect(r.evaluatedAt).toBe("2026-06-10T00:00:00.000Z")
  })

  it("só CV disponível → cross-validation", () => {
    const r = selectPrimaryModelMetric({ ...EMPTY, crossValidationMae: 0.579, sampleSize: 191 })
    expect(r.source).toBe("cross-validation")
    expect(r.mae).toBe(0.579)
  })

  it("só métrica de treino (in-sample) disponível → NUNCA vira principal", () => {
    const r = selectPrimaryModelMetric({ ...EMPTY, trainMae: 0.545, sampleSize: 191 })
    expect(r.source).toBe("unavailable")
    expect(r.mae).toBeNull()
  })

  it("nenhuma métrica → unavailable com tudo null", () => {
    const r = selectPrimaryModelMetric(EMPTY)
    expect(r).toEqual({ mae: null, source: "unavailable", sampleSize: null, evaluatedAt: null })
  })

  it("prospectiva com amostra suficiente mas MAE null cai pra CV", () => {
    const r = selectPrimaryModelMetric({
      ...EMPTY,
      crossValidationMae: 0.58,
      prospectiveMae: null,
      prospectiveSampleSize: 100,
    })
    expect(r.source).toBe("cross-validation")
  })
})

describe("calculateRelativeErrorReduction", () => {
  it("calcula redução positiva (modelo melhor que baseline)", () => {
    const r = calculateRelativeErrorReduction(0.58, 0.75)
    expect(r).not.toBeNull()
    expect((r as number) * 100).toBeCloseTo(22.67, 1)
  })

  it("redução negativa quando o modelo é pior que o baseline", () => {
    const r = calculateRelativeErrorReduction(0.9, 0.75)
    expect(r).toBeLessThan(0)
  })

  it("baseline igual a zero → null (não absurdo)", () => {
    expect(calculateRelativeErrorReduction(0.5, 0)).toBeNull()
  })

  it("baseline negativo ou valores não-finitos → null", () => {
    expect(calculateRelativeErrorReduction(0.5, -1)).toBeNull()
    expect(calculateRelativeErrorReduction(Number.NaN, 0.75)).toBeNull()
    expect(calculateRelativeErrorReduction(0.5, Infinity)).toBeNull()
  })

  it("modelo com MAE negativo → null", () => {
    expect(calculateRelativeErrorReduction(-0.1, 0.75)).toBeNull()
  })
})

describe("describeMetricSource", () => {
  it("rotula cada fonte com texto honesto e não-ambíguo", () => {
    expect(describeMetricSource("prospective").title).toMatch(/prospectiv/i)
    expect(describeMetricSource("cross-validation").title).toMatch(/validação cruzada/i)
    expect(describeMetricSource("unavailable").title).toMatch(/indisponível/i)
    // tooltip da CV explica que é fora da amostra de treino
    expect(describeMetricSource("cross-validation").tooltip).toMatch(/fora da amostra/i)
    // tooltip da prospectiva explica que é antes do rótulo real
    expect(describeMetricSource("prospective").tooltip).toMatch(/antes/i)
  })
})
