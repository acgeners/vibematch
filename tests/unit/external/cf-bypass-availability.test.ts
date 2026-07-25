import { describe, it, expect, vi, beforeEach } from "vitest"

// `isCfBypassUnavailable` é a regra central que impede a classe de bug "a fonte
// CF-gated some quando o circuito do FlareSolverr abre, mesmo com o sidecar são".
// Ela é consumida por comix.ts, mangago.ts e animeplanet.ts. Mockamos o
// comix-render-client pra controlar se o sidecar está configurado sem tocar em rede.
vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: vi.fn(),
  renderHtmlViaSidecar: vi.fn(),
}))

import { isCfBypassUnavailable } from "@/lib/external/flaresolverr"
import { isComixRenderConfigured } from "@/lib/external/comix-render-client"

const sidecarConfigured = vi.mocked(isComixRenderConfigured)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("isCfBypassUnavailable — o sidecar não pode ser vetado pelo circuito do FlareSolverr", () => {
  it("sidecar CONFIGURADO ⇒ nunca indisponível (era o bug: o circuito do FS derrubava a fonte)", () => {
    // Este é o cenário que quebrava: FlareSolverr fora (Docker desligado, circuito
    // aberto) mas o sidecar — a camada PRIMÁRIA — de pé. A fonte tem que seguir.
    sidecarConfigured.mockReturnValue(true)
    expect(isCfBypassUnavailable()).toBe(false)
  })

  it("sem sidecar e circuito do FlareSolverr FECHADO (default) ⇒ disponível", () => {
    // Sem circuito aberto ainda há o FlareSolverr como caminho → não desistir.
    sidecarConfigured.mockReturnValue(false)
    expect(isCfBypassUnavailable()).toBe(false)
  })
})
