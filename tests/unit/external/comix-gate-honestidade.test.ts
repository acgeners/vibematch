import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O gate é ESTADO DE MÓDULO: cada teste precisa de instância limpa.
async function freshGate() {
  vi.resetModules()
  return await import("@/lib/external/comix-gate")
}

describe("ComixGate: sucesso TARDIO não apaga o descarte", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("ok que chega DEPOIS de um delivery_timeout não devolve o estado a 'ok'", async () => {
    // A regressão real: `withTimeout` só para de esperar — a promise segue viva e suas
    // chamadas HTTP chamam recordComixOk() lá na frente. O painel ficava verde enquanto
    // a Comix entregava zero em toda obra.
    const gate = await freshGate()

    gate.recordComixFailure("delivery_timeout")
    expect(gate.getComixStatus().failReason).toBe("delivery_timeout")

    // A coleta abandonada volta e "tem sucesso".
    gate.recordComixOk()

    const s = gate.getComixStatus()
    expect(s.failReason).toBe("delivery_timeout") // a evidência do descarte sobrevive
    expect(s.lastOkAt).not.toBeNull() // mas a fonte está viva, e isso é registrado
  })

  it("passada a janela de guarda, um ok volta a limpar o estado", async () => {
    // A guarda não pode prender o gate em falha para sempre: tráfego bom posterior
    // precisa recuperar, senão vira o alarme que sempre toca.
    const gate = await freshGate()
    gate.recordComixFailure("delivery_timeout")

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 60_000)
    gate.recordComixOk()

    expect(gate.getComixStatus().failReason).toBeNull()
  })

  it("um ok normal (sem timeout antes) segue limpando — recuperação pelo canário", async () => {
    const gate = await freshGate()
    gate.recordComixFailure("cloudflare_challenge")
    gate.recordComixOk()
    expect(gate.getComixStatus().failReason).toBeNull()
    expect(gate.getComixStatus().state).toBe("ok")
  })
})

describe("ComixGate: a cegueira do sidecar é VISÍVEL", () => {
  beforeEach(() => vi.stubEnv("COMIX_RENDER_URL", "http://sidecar:8790"))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("sidecar barrado na comix.to aparece no status SEM rebaixar o estado", async () => {
    // Degradação, não falha: com o FlareSolverr de pé a fonte segue entregando. Mas
    // sem esta visibilidade o bloqueio durou 13 dias sem mover nenhum indicador.
    vi.resetModules()
    const { renderHtmlViaSidecar } = await import("@/lib/external/comix-render-client")
    const gate = await import("@/lib/external/comix-gate")

    expect(gate.getComixStatus().sidecarBlocked).toBe(false)

    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: "upstream_blocked", meta: { elapsedMs: 13200, source: "render:browser" } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )
    await renderHtmlViaSidecar("https://comix.to/title/0zex5")

    const s = gate.getComixStatus()
    expect(s.sidecarBlocked).toBe(true)
    expect(s.state).not.toBe("down") // o FlareSolverr cobre — não é queda da fonte
  })
})
