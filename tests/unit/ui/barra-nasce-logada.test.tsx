import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"

// A barra superior decide os destinos e o "Entrar" por `useIsSignedIn`. Ela tem de nascer com
// a sessão que o servidor já conhece; a chamada do navegador (que aqui nunca volta) só confirma.

vi.mock("@/server/actions/admin", () => ({
  getCurrentUserChrome: () => new Promise(() => {}),
}))
vi.mock("@/lib/use-refresh", () => ({ useChromeData: () => {} }))

const { AdminProvider, useIsSignedIn, useRole } = await import("@/components/layout/admin-context")

function Probe() {
  return (
    <span data-testid="estado">
      {useIsSignedIn() ? "logado" : "visitante"} · {useRole()}
    </span>
  )
}

describe("a barra nasce com a sessão que o servidor conhece", () => {
  it("com sessão, já começa logada, e o papel segue fail-closed até confirmar", () => {
    render(
      <AdminProvider initialSignedIn>
        <Probe />
      </AdminProvider>,
    )
    expect(screen.getByTestId("estado").textContent).toBe("logado · leitor")
  })

  it("sem a informação, continua começando como visitante", () => {
    render(
      <AdminProvider>
        <Probe />
      </AdminProvider>,
    )
    expect(screen.getByTestId("estado").textContent).toBe("visitante · leitor")
  })

  it("o layout raiz passa ao provedor o que o middleware disse", () => {
    const src = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8")
    expect(src).toMatch(/\.get\(SIGNED_IN_HEADER\)/)
    expect(src).toMatch(/<AdminProvider[^>]*\binitialSignedIn=/)
  })
})
