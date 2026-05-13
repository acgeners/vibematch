import { describe, it, expect } from "vitest"
import { fitRidge, fitRidgeCV, predictRidge } from "@/lib/ml/ridge"

describe("Ridge regression", () => {
  it("recovers a simple linear relationship", () => {
    // y = 2*x1 + 3*x2 + 1 (intercept), feature já centralizada
    const X = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    ]
    const y = X.map(([a, b]) => 2 * a + 3 * b + 1)
    const model = fitRidge(X, y, 0.001)
    expect(model.coefficients[0]).toBeCloseTo(2, 1)
    expect(model.coefficients[1]).toBeCloseTo(3, 1)
    expect(model.intercept).toBeCloseTo(1, 1)
  })

  it("predicts with the trained model", () => {
    const X = [[-1], [1], [-2], [2], [-3], [3]]
    const y = X.map(([a]) => 5 * a + 2)
    const model = fitRidge(X, y, 0.001)
    const preds = predictRidge([[0], [4]], model)
    expect(preds[0]).toBeCloseTo(2, 1)
    expect(preds[1]).toBeCloseTo(22, 1)
  })

  it("RidgeCV picks a finite alpha and produces predictions", () => {
    const X: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 50; i++) {
      const a = (i % 10) - 5
      const b = Math.sin(i)
      X.push([a, b])
      y.push(0.5 * a + 0.2 * b + 7 + (Math.random() - 0.5) * 0.1)
    }
    const model = fitRidgeCV(X, y, [0.1, 1, 10, 100], 5)
    expect([0.1, 1, 10, 100]).toContain(model.alpha)
    expect(model.cvMAE).toBeGreaterThan(0)
    expect(model.cvMAE).toBeLessThan(2)
    const preds = predictRidge(X, model)
    expect(preds.length).toBe(50)
  })
})
