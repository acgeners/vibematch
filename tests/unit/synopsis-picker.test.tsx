import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render, screen, within, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { SynopsisPicker, normalizeSynopsisChoices } from "@/components/titles/synopsis-picker"
import type { SynopsisChoice } from "@/components/titles/synopsis-picker"
import { buildSynopsisPool } from "@/components/titles/update-data-dialog"

// jsdom não define ResizeObserver; o SynopsisPicker instancia um pra medir se a sinopse
// cabe em N linhas (feature "expandível", commit 565b2bd) — sem o stub, o effect lança e
// os testes que montam o componente quebram. No-op basta: estes testes exercitam
// edição/inclusão, não a medição de layout (que jsdom não faz de qualquer forma).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

/** Casca controlada: o picker é controlado pelo pai, igual nos dois diálogos reais. */
function Harness({
  initial,
  onState,
}: {
  initial: SynopsisChoice[]
  onState: (s: SynopsisChoice[]) => void
}) {
  const [choices, setChoices] = useState(initial)
  return (
    <SynopsisPicker
      choices={choices}
      onChange={(next) => {
        setChoices(next)
        onState(next)
      }}
    />
  )
}

const MU: SynopsisChoice = {
  source: "mangaupdates",
  text: "I transmigrated twice and woke up as Princess Alicia Ashtad.",
  included: true,
  isPrimary: true,
}
const MANGAGO: SynopsisChoice = {
  source: "mangago",
  text: "Read manhwa I Never Abandoned the Tyrant.",
  included: true,
  isPrimary: false,
}

describe("normalizeSynopsisChoices", () => {
  it("promove a primeira incluída quando a principal sai da seleção", () => {
    const out = normalizeSynopsisChoices([
      { ...MU, included: false, isPrimary: true },
      { ...MANGAGO, included: true },
    ])
    expect(out.map((c) => c.isPrimary)).toEqual([false, true])
  })

  it("nunca deixa mais de uma principal", () => {
    const out = normalizeSynopsisChoices([
      { ...MU, isPrimary: true },
      { ...MANGAGO, isPrimary: true },
    ])
    expect(out.filter((c) => c.isPrimary)).toHaveLength(1)
  })

  it("sem nenhuma incluída, não sobra principal", () => {
    const out = normalizeSynopsisChoices([
      { ...MU, included: false },
      { ...MANGAGO, included: false },
    ])
    expect(out.some((c) => c.isPrimary)).toBe(false)
  })
})

describe("buildSynopsisPool", () => {
  it("mantém as sinopses SALVAS quando a busca externa traz outras", () => {
    // O bug que isto trava: o passo listava só as externas e o save (delete +
    // re-insert) apagava a manual do usuário a cada "Atualizar dados".
    const pool = buildSynopsisPool(
      [{ source: "manual", text: "Minha sinopse escrita à mão.", isPrimary: true }],
      [{ source: "mangaupdates", text: MU.text }]
    )
    expect(pool.map((c) => c.text)).toContain("Minha sinopse escrita à mão.")
    expect(pool.find((c) => c.text === "Minha sinopse escrita à mão.")).toMatchObject({
      saved: true,
      included: true,
      isPrimary: true,
    })
    // A externa nova entra desmarcada — o default é preservar o que já existe.
    expect(pool.find((c) => c.source === "mangaupdates")).toMatchObject({ included: false })
  })

  it("dedupa por texto: a mesma sinopse voltando da fonte não vira duas linhas", () => {
    const pool = buildSynopsisPool(
      [{ source: "mangaupdates", text: MU.text, isPrimary: true }],
      [{ source: "mangaupdates", text: `  ${MU.text.toUpperCase()}  ` }]
    )
    expect(pool).toHaveLength(1)
    expect(pool[0].saved).toBe(true)
  })

  it("obra sem nada salvo mantém o comportamento antigo (externas marcadas)", () => {
    const pool = buildSynopsisPool([], [{ source: "mangaupdates", text: MU.text }])
    expect(pool).toMatchObject([{ included: true, isPrimary: true }])
  })
})

describe("SynopsisPicker — editar o texto", () => {
  it("editar uma sinopse de fonte converte para manual e rotula a origem", () => {
    // Não é cosmético: com source "manual" na principal, o prompt da avaliação IA
    // declara a sinopse como "autoridade máxima sobre a obra".
    const states: SynopsisChoice[][] = []
    render(<Harness initial={[MU, MANGAGO]} onState={(s) => states.push(s)} />)

    fireEvent.click(screen.getAllByRole("button", { name: /Editar o texto/i })[0])
    const box = screen.getByRole("textbox")
    fireEvent.change(box, { target: { value: "Texto que eu reescrevi." } })
    fireEvent.click(screen.getByRole("button", { name: /Salvar texto/i }))

    const last = states.at(-1)!
    expect(last[0]).toMatchObject({
      source: "manual",
      editedFrom: "mangaupdates",
      text: "Texto que eu reescrevi.",
    })
    expect(last[1].source).toBe("mangago") // a outra não é tocada
    expect(screen.getByText(/Manga Updates · editada/i)).toBeTruthy()
  })

  it("Cancelar descarta o rascunho sem tocar no texto salvo", () => {
    const states: SynopsisChoice[][] = []
    render(<Harness initial={[MU]} onState={(s) => states.push(s)} />)

    fireEvent.click(screen.getByRole("button", { name: /Editar o texto/i }))
    const box = screen.getByRole("textbox")
    fireEvent.change(box, { target: { value: `${MU.text} lixo` } })
    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }))

    expect(states).toHaveLength(0) // nenhuma mudança propagada pro pai
    expect(screen.getByText(MU.text)).toBeTruthy()
  })

  it("clicar no card alterna a inclusão, e clicar no lápis não", () => {
    const states: SynopsisChoice[][] = []
    render(<Harness initial={[MU, MANGAGO]} onState={(s) => states.push(s)} />)

    const cards = screen.getAllByRole("checkbox", { name: /Incluir a sinopse de/i })
    fireEvent.click(cards[1])
    expect(states.at(-1)![1].included).toBe(false)

    // O lápis abre o editor sem alterar a seleção do card que o contém.
    const before = states.length
    fireEvent.click(within(cards[0]).getByRole("button", { name: /Editar o texto/i }))
    expect(states).toHaveLength(before)
    expect(screen.getByRole("textbox")).toBeTruthy()
  })
})
