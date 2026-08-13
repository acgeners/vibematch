import { vi, describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/server/actions/works", () => ({
  setChaptersRead: vi.fn(async () => ({ data: {} })),
  setReadingStatusForWorks: vi.fn(async () => ({ data: {} })),
}))
vi.mock("@/components/titles/work-status-gate", () => ({ useWorkStatusGate: () => ({ requestOpen: vi.fn() }) }))

import { QuickChaptersCell } from "@/components/titles/quick-personal-controls"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"

/**
 * "0 / 73" na faixa de stats só faz sentido pra quem está lendo.
 *
 * Em Want to Read, Untracked, Not Now e Not Interested o zero não é progresso: é o valor
 * default de quem nunca abriu a obra — e desenhado como fração ele LÊ como leitura
 * abandonada. A régua vem de `personal_status.tracks_progress`, e o teste a deriva da
 * tabela em vez de repetir os quatro nomes: status novo no Supabase entra sozinho.
 */

afterEach(cleanup)

const TODOS = Object.values(PERSONAL_STATUSES_BY_ID)

function renderCell(statusId: number | null, canEdit = true) {
  return render(
    <QuickChaptersCell
      workId="w1"
      totalChapters={73}
      chaptersRead={0}
      personalStatusId={statusId}
      canEdit={canEdit}
    />,
  )
}

describe("capítulos lidos na faixa de stats", () => {
  it("quem acompanha progresso vê a fração; quem não acompanha vê só o total", () => {
    for (const status of TODOS) {
      const { container } = renderCell(status.id)
      const texto = container.textContent ?? ""
      if (status.tracksProgress) {
        expect(texto, `${status.status} deveria mostrar a fração`).toContain("0 / 73")
      } else {
        expect(texto, `${status.status} não deveria mostrar fração`).not.toContain("/")
        expect(texto).toContain("73")
      }
      cleanup()
    }
  })

  it("a régua cobre hoje exatamente os quatro status de 'ainda não comecei'", () => {
    // Não é a régua — é o RETRATO dela. Se um status novo entrar sem progresso, este caso
    // falha e alguém decide de propósito, em vez de descobrir pela tela.
    const semProgresso = TODOS.filter((s) => !s.tracksProgress).map((s) => s.status).sort()
    expect(semProgresso).toEqual(["Not Interested", "Not Now", "Untracked", "Want to Read"])
  })

  it("obra nunca tocada (sem status) também não mostra fração", () => {
    const { container } = renderCell(null)
    expect(container.textContent).not.toContain("/")
  })

  it("sem permissão de escrita vale a mesma régua", () => {
    // O ramo somente-leitura é outro caminho de render — foi por ele que a 1ª versão
    // deixou "0 / 73 capítulos" na tela do visitante.
    const { container } = renderCell(10 /* Untracked */, false)
    expect(container.textContent).toContain("73 capítulos")
    expect(container.textContent).not.toContain("0 /")
  })

  it("com progresso de verdade, a fração aparece", () => {
    render(
      <QuickChaptersCell
        workId="w1"
        totalChapters={73}
        chaptersRead={12}
        personalStatusId={2 /* Reading */}
        canEdit
      />,
    )
    expect(screen.getByText("12 / 73")).toBeTruthy()
  })
})
