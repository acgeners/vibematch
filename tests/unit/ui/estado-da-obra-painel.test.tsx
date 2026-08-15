import { vi, describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))

import { WorkStatePanel } from "@/components/titles/work-state-panel"
import type { WorkStatePanelProps } from "@/components/titles/work-state-panel"

/**
 * O painel "Estado da obra" — teste de RENDER de propósito: o que ele guarda é a régua de
 * QUEM VIRA ALERTA, e ela só existe na tela.
 *
 * Medido nas 988 obras (13/08/2026): 562 (57%) receberam reviews depois da última
 * avaliação e 502 (51%) nunca tiveram tags inferidas. Chip para isso deixaria o painel
 * âmbar em quase toda obra — e alarme que sempre toca não é lido. Vira número; chip é só
 * pro que é raro e acionável (Veredito desatualizado: 17 obras · 1,7%).
 */

const BASE: WorkStatePanelProps = {
  reviews: { total: 196, sources: 8, digestN: 155, evalLabel: "15 de 30", newSinceEval: false },
  dates: {
    created: "2026-05-02T10:00:00Z",
    refreshed: null,
    evaluated: "2026-05-22T07:36:00Z",
    digest: "2026-07-14T12:00:00Z",
    tags: null,
  },
  tagCount: 98,
  externalIds: { mangaupdates: "1", anilist: "2" },
  pending: { verdictStale: false, reviewPending: false, neverEvaluated: false, noDigest: false },
}

function renderPainel(over: Partial<WorkStatePanelProps> = {}) {
  return render(
    <WorkStatePanel
      {...BASE}
      {...over}
      reviews={{ ...BASE.reviews, ...(over.reviews ?? {}) }}
      dates={{ ...BASE.dates, ...(over.dates ?? {}) }}
      pending={{ ...BASE.pending, ...(over.pending ?? {}) }}
    />,
  )
}

afterEach(cleanup)

describe("painel Estado da obra", () => {
  it("responde as três perguntas: matéria-prima, frescor e pendência", () => {
    const { container } = renderPainel()
    expect(screen.getByText(/196 reviews/)).toBeTruthy()
    expect(screen.getByText(/8 fontes/)).toBeTruthy()
    // Quantas foram ao prompt da avaliação — hoje isso vive só no tooltip do selo ✨.
    expect(screen.getByText("15 de 30")).toBeTruthy()
    expect(screen.getByText("155 de 196")).toBeTruthy()
    expect(container.textContent).toContain("criada")
    expect(container.textContent).toContain("avaliada")
  })

  it("conta TAGS na matéria-prima — é a única entrada do Alinhamento", () => {
    // Reviews e fontes já estavam aqui; tags não, e são a matéria-prima EXCLUSIVA do
    // Alinhamento (percentil médio 8,5 em obras com ≤10 tags contra 80,8 em 100+).
    const { container } = renderPainel({ tagCount: 14 })
    expect(screen.getByText(/14 tags/)).toBeTruthy()
    // NÚMERO, nunca chip: 21% do catálogo está abaixo de 25 tags.
    expect(container.textContent).toContain("Nada pendente")
    expect(screen.getByText(/14 tags/).className).not.toMatch(/amber/)
  })

  it("singular de tag não sai como '1 tags'", () => {
    renderPainel({ tagCount: 1 })
    expect(screen.getByText(/1 tag(?!s)/)).toBeTruthy()
  })

  it("o que vale pra maioria do catálogo é NÚMERO, não alerta", () => {
    // "Chegaram reviews novas" acontece em 57% das obras: informação, sem cor de estado.
    const { container } = renderPainel({ reviews: { ...BASE.reviews, newSinceEval: true } })
    const aviso = screen.getByText(/reviews desde a avaliação/)
    expect(aviso.className).not.toMatch(/amber/)
    expect(container.textContent).toContain("Nada pendente")
  })

  it("o que é raro e acionável vira chip âmbar", () => {
    renderPainel({ pending: { ...BASE.pending, verdictStale: true, noDigest: true } })
    const chip = screen.getByText("Veredito desatualizado")
    expect(chip.className).toMatch(/amber/)
    expect(screen.getByText("Sem síntese das reviews")).toBeTruthy()
    expect(screen.queryByText("Nada pendente")).toBeNull()
  })

  it("sem pendência, diz isso — em vez de deixar a coluna vazia", () => {
    renderPainel()
    expect(screen.getByText("Nada pendente")).toBeTruthy()
  })

  it("as datas seguem a régua dos selos ✨, e ausência não vira data inventada", () => {
    const { container } = renderPainel({ dates: { ...BASE.dates, refreshed: null, tags: null } })
    // Formato numérico porque são antigas; o "—" é o que diz "nunca aconteceu".
    expect(container.textContent).toContain("02/05/2026")
    expect(container.textContent).toContain("—")
  })

  it("a leitura pessoal só aparece pra quem leu", () => {
    const { container } = renderPainel()
    expect(container.textContent).not.toContain("sua leitura")
    cleanup()
    const comLeitura = renderPainel({ dates: { ...BASE.dates, lastRead: "2026-08-01T00:00:00Z" } })
    expect(comLeitura.container.textContent).toContain("sua leitura")
  })
})
