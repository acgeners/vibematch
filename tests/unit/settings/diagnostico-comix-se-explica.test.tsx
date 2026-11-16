import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
const checkComixHealth = vi.fn()
vi.mock("@/server/actions/comix-resolver", () => ({ checkComixHealth: (...a: unknown[]) => checkComixHealth(...a) }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))

import { act, fireEvent, render, screen } from "@testing-library/react"
import { ComixHealthPanel } from "@/components/settings/comix-health-panel"

/**
 * 🔴 O toast dizia "Comix com problemas — veja o diagnóstico abaixo." Ele aparece no canto
 * da tela, longe do painel, e o "diagnóstico" era uma linha com o erro cortado (o resto só
 * no tooltip). Hoje o toast nomeia o que falhou, e a linha com falha mostra o erro inteiro
 * e o que fazer.
 *
 * E sem o contorno do Cloudflare o teste fica desabilitado: a Comix barra o servidor do Fly
 * (403), e o canário reprovado de lá gravaria "Comix fora" no banco também para o Mac.
 */

const ERRO_LONGO = "canário abc12 não resolveu — 403 do Cloudflare na página /title/abc12 depois de 3 tentativas"

function resultado() {
  return {
    checkedAt: "2026-11-16T10:00:00Z",
    checks: [
      { ok: true, key: "flaresolverr", label: "FlareSolverr", detail: "ativo" },
      { ok: false, key: "detail", label: "Detalhe (SSR)", detail: ERRO_LONGO, ms: 900 },
      { ok: true, key: "reviews", label: "Reviews (threads)", detail: "40 comentários do canário", ms: 1200 },
      { ok: true, key: "image", label: "Imagem (CDN)", detail: "200 image/webp", ms: 300 },
    ],
  }
}

describe("diagnóstico da Comix", () => {
  beforeEach(() => {
    toast.error.mockClear()
    checkComixHealth.mockReset()
  })

  it("o toast nomeia o que falhou, sem mandar olhar 'abaixo'", async () => {
    checkComixHealth.mockResolvedValueOnce(resultado())
    render(<ComixHealthPanel accent="amber" available />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Testar agora/ }))
    })
    const [msg, opts] = toast.error.mock.calls[0]
    expect(msg).toContain("Detalhe (SSR)")
    expect(msg).not.toMatch(/abaixo/)
    expect(opts.description).toBe(ERRO_LONGO)
  })

  it("a falha aparece inteira, com o que fazer; o sucesso não ganha dica", async () => {
    checkComixHealth.mockResolvedValueOnce(resultado())
    render(<ComixHealthPanel accent="amber" available />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Testar agora/ }))
    })
    const linha = screen.getByText(ERRO_LONGO)
    expect(linha.className).not.toMatch(/\btruncate\b/)
    expect(screen.getByText(/Abra comix\.to no navegador/)).toBeTruthy()
    expect(screen.queryByText(/Os comentários vêm de outra rota/)).toBeNull()
  })

  it("sem o contorno do Cloudflare o botão fica desabilitado e diz por quê", () => {
    render(<ComixHealthPanel accent="amber" available={false} />)
    const botao = screen.getByRole("button", { name: /Testar agora/ }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(screen.getByText(/Indisponível neste servidor/)).toBeTruthy()
  })
})
