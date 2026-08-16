import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

import { AiPendingGuardDialog } from "@/components/settings/ai-pending-guard-dialog"
import type { AiPendingItem } from "@/components/settings/ai-pending-guard-dialog"

/**
 * A trava abre POR CIMA da ação que a disparou (recalcular / recalibrar), e essa
 * ação mora na página atual. Navegar em cima dela para resolver a pendência
 * obriga a refazer o caminho até o botão depois — por isso os dois caminhos de
 * "ir resolver" abrem em ABA NOVA, e os dois têm que concordar: um abrindo aba e
 * o outro navegando em cima seriam dois critérios pro mesmo fato.
 *
 * Teste de RENDER de propósito: o que regride aqui é o atributo/handler do
 * elemento desenhado, não uma função pura.
 */

const items: AiPendingItem[] = [
  { label: "Embeddings", count: 1, href: "/curation/settings?g=ia#card-embeddings" },
]

afterEach(cleanup)

describe("trava de artefatos de IA pendentes", () => {
  it("'Resolver pendências antes' abre em aba nova, sem navegar por cima", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const onProceed = vi.fn()

    render(
      <AiPendingGuardDialog
        open
        onOpenChange={() => {}}
        items={items}
        onProceed={onProceed}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Resolver pendências antes" }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toBe(items[0].href)
    expect(open.mock.calls[0][1]).toBe("_blank")
    // Cancelar não pode disparar a ação que a trava está segurando.
    expect(onProceed).not.toHaveBeenCalled()

    open.mockRestore()
  })

  it("o link de cada pendência também abre em aba nova", () => {
    render(
      <AiPendingGuardDialog
        open
        onOpenChange={() => {}}
        items={items}
        onProceed={() => {}}
      />,
    )

    const link = screen.getByRole("link", { name: "Embeddings" })
    expect(link.getAttribute("href")).toBe(items[0].href)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
  })
})
