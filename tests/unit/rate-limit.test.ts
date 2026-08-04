import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { withinRateLimit, resetRateLimits } from "@/lib/rate-limit"

beforeEach(() => {
  resetRateLimits()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("withinRateLimit", () => {
  it("libera até o limite e nega o excedente", () => {
    for (let i = 0; i < 3; i++) {
      expect(withinRateLimit("u1", 3, 60_000), `hit ${i + 1} deveria passar`).toBe(true)
    }
    expect(withinRateLimit("u1", 3, 60_000)).toBe(false)
  })

  it("isola chaves diferentes", () => {
    expect(withinRateLimit("u1", 1, 60_000)).toBe(true)
    expect(withinRateLimit("u1", 1, 60_000)).toBe(false)
    expect(withinRateLimit("u2", 1, 60_000), "o teto de u1 não pode valer pra u2").toBe(true)
  })

  it("volta a liberar quando a janela passa", () => {
    expect(withinRateLimit("u1", 1, 60_000)).toBe(true)
    expect(withinRateLimit("u1", 1, 60_000)).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(withinRateLimit("u1", 1, 60_000), "passada a janela, o token volta").toBe(true)
  })

  /**
   * O caso que a implementação ingênua erra: se a tentativa NEGADA também registrasse o hit, um
   * cliente em retry agressivo manteria a janela sempre cheia e o bloqueio nunca expiraria — o
   * limite viraria banimento permanente para quem apertar F5 rápido demais.
   */
  it("tentativa negada não empurra a janela para frente", () => {
    expect(withinRateLimit("u1", 1, 1_000)).toBe(true)
    // Martela DENTRO da janela (até 900ms; em 1000 o 1º hit expira e a liberação é legítima),
    // e nada disso pode prorrogar o bloqueio.
    for (let t = 0; t < 900; t += 100) {
      vi.advanceTimersByTime(100)
      expect(withinRateLimit("u1", 1, 1_000), `martelo em ${t + 100}ms`).toBe(false)
    }
    vi.advanceTimersByTime(101)
    expect(
      withinRateLimit("u1", 1, 1_000),
      "o martelo durante a janela não pode adiar a liberação",
    ).toBe(true)
  })
})
