import { vi, describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/server/actions/external", () => ({
  saveWorkSourceSelections: vi.fn(),
  revalidateWorkSources: vi.fn(async () => ({
    data: {
      queriesUsed: ["Obra de Teste"],
      // O hid vinculado está MORTO (404): a Comix não traz candidato nenhum.
      candidatesPerSource: { comix: [], mangago: [] },
      sourceHealth: {},
      currentSelections: [{ source: "comix", externalId: "morto", isRejected: false }],
    },
  })),
}))
// O caso que escondia o campo: sidecar configurado (`COMIX_RENDER_URL`), como no localhost:3000.
vi.mock("@/server/actions/comix-resolver", () => ({
  setComixHidManually: vi.fn(),
  isComixAutoResolveAvailable: vi.fn(async () => true),
}))

import { SourceSelectionStep } from "@/components/titles/source-selection-step"

/**
 * No lote de capítulos de 11/11, 12 obras tinham o hid da Comix devolvendo 404. O conserto é colar
 * o hid novo no "Atualizar dados" — e o campo SUMIA no localhost:3000, porque o sidecar estava
 * configurado e o app supunha que a Comix "já vinha resolvida". A descoberta de hid está morta,
 * então ali só restava declarar a obra ausente.
 *
 * Teste de RENDER: o que regride é o campo deixar de aparecer, e isso só existe na árvore.
 */
describe("o campo de hid manual da Comix", () => {
  it("aparece mesmo com o sidecar configurado, para trocar um hid morto", async () => {
    render(<SourceSelectionStep workId="w1" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByPlaceholderText("hid ou URL da comix.to")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Validar e adicionar" })).toBeTruthy()
  })
})
