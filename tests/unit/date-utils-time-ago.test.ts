import { describe, it, expect, vi, afterEach } from "vitest"
import { formatTimeAgo } from "@/lib/date-utils"

/**
 * `formatTimeAgo` encaixa no meio de uma frase ("Enviado {x}."), então tudo tem de sair
 * minúsculo — é o que o separa de `formatRelativeDate`, que é rótulo de coluna.
 *
 * O relógio é fixado porque a função lê `new Date()`: sem isso o teste de "há 3 dias" mudaria
 * de resultado conforme a hora em que a suíte roda.
 */
const agora = new Date("2026-08-04T12:00:00Z")

afterEach(() => vi.useRealTimers())

function em(iso: string): string {
  vi.useFakeTimers()
  vi.setSystemTime(agora)
  return formatTimeAgo(iso)
}

describe("formatTimeAgo", () => {
  it("hoje, ontem e dias", () => {
    expect(em("2026-08-04T09:00:00Z")).toBe("hoje")
    expect(em("2026-08-03T23:00:00Z")).toBe("ontem")
    expect(em("2026-08-01T12:00:00Z")).toBe("há 3 dias")
  })

  it("conta dias de CALENDÁRIO, não janelas de 24 h", () => {
    // 23h de ontem visto à meia-noite e pouco de hoje são "ontem", não "hoje" (1h30 de
    // diferença, mas outro dia) — é a mesma regra do `daysSince` de pace-bands.
    //
    // ⚠️ Sem `Z`: `differenceInCalendarDays` compara dias LOCAIS. Escrito em UTC, este teste
    // afirma coisas diferentes conforme o fuso de quem roda — em UTC−3 os dois instantes caem
    // no mesmo dia local e a asserção certa passa a ser "hoje". Data-hora sem offset é lida
    // como local em toda engine, então assim vale em qualquer fuso.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-04T00:30:00"))
    expect(formatTimeAgo("2026-08-03T23:00:00")).toBe("ontem")
  })

  it("data futura não vira 'há -1 dias'", () => {
    expect(em("2026-08-09T12:00:00Z")).toBe("hoje")
  })

  it("acima de 30 dias vira data — 'há 412 dias' é preciso e inútil", () => {
    expect(em("2026-01-15T12:00:00Z")).toBe("em 15/01")
    expect(em("2024-01-15T12:00:00Z")).toBe("em 15/01/24")
  })

  it("entrada inválida não quebra a frase", () => {
    expect(formatTimeAgo(null)).toBe("—")
    expect(formatTimeAgo("não é data")).toBe("—")
  })
})
