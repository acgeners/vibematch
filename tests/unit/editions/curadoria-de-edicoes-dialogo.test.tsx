import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { WorkEditionCuration } from "@/server/actions/work-editions"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bandForScore, rubricTitle } from "@/lib/criteria/justification"

/**
 * O diálogo "Edições da obra" RENDERIZADO: um teste da regra pura passaria verde com a nota atual
 * fora da tela, com o aviso do "Marcar como 18+" sumido ou com o Salvar gravando sem ninguém ter
 * escolhido nada (obra sem estado tratada como "uma edição só" e regravada como decisão).
 */
vi.mock("server-only", () => ({}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))

const getWorkEditionCuration = vi.fn()
const saveWorkEditionCuration = vi.fn()
const revertWorkEditionCuration = vi.fn()
vi.mock("@/server/actions/work-editions", () => ({
  getWorkEditionCuration: (...a: unknown[]) => getWorkEditionCuration(...a),
  saveWorkEditionCuration: (...a: unknown[]) => saveWorkEditionCuration(...a),
  revertWorkEditionCuration: (...a: unknown[]) => revertWorkEditionCuration(...a),
}))

// Radix Select usa APIs de ponteiro que o jsdom não tem.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const base: WorkEditionCuration = {
  state: "mixed",
  r18ExtraChapters: false,
  evidence: {},
  basis: "reviews",
  decidedBy: "audit",
  decidedAt: "2026-10-10T00:00:00Z",
  scores: { r18: { score: 9, source: "reused_existing" } },
  adultOverride: null,
  revertTarget: null,
  canRevert: false,
}
const curada: WorkEditionCuration = {
  ...base,
  basis: "curator",
  decidedBy: "curator",
  revertTarget: "Volta para: Versão normal + versão R18 (auditoria).",
  canRevert: true,
}

async function abrir(data: WorkEditionCuration) {
  getWorkEditionCuration.mockResolvedValue({ data })
  const { WorkEditionsDialog } = await import("@/components/titles/work-editions-dialog")
  render(<WorkEditionsDialog workId="obra-1" open onOpenChange={() => {}} />)
  await screen.findByText("Estado")
}

function escolher(combobox: HTMLElement, opcao: string) {
  fireEvent.keyDown(combobox, { key: " " })
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: opcao }))
}

const salvar = () => screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement

beforeEach(() => {
  getWorkEditionCuration.mockReset()
  saveWorkEditionCuration.mockReset()
  saveWorkEditionCuration.mockResolvedValue({ data: { changed: true, recalcMarked: true } })
  revertWorkEditionCuration.mockReset()
  revertWorkEditionCuration.mockResolvedValue({ data: { changed: true, recalcMarked: false } })
})
afterEach(cleanup)

describe("diálogo Versões da obra", () => {
  it("mostra a nota atual de cada edição com a procedência, e o Salvar nasce desligado", async () => {
    await abrir(base)
    expect(screen.getByText("Hoje: 9,0 · Da avaliação da obra")).toBeTruthy()
    expect(screen.getByText("Hoje: Sem registro (não avaliado)")).toBeTruthy()
    expect(screen.getByText(/Estado decidido por auditoria/)).toBeTruthy()
    expect(salvar().disabled).toBe(true)
  })

  it("informar a nota da versão normal grava SÓ ela, com vírgula aceita", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão normal" }), "Informar nota")
    fireEvent.change(screen.getByRole("textbox", { name: /Versão normal/ }), { target: { value: "4,5" } })
    expect(salvar().disabled).toBe(false)
    fireEvent.click(salvar())
    await waitFor(() =>
      expect(saveWorkEditionCuration).toHaveBeenCalledWith("obra-1", {
        state: "mixed",
        r18ExtraChapters: false,
        scores: { normal: { kind: "nota", value: 4.5 }, r18: { kind: "manter" } },
      }),
    )
  })

  it("nota fora da grade avisa e trava o Salvar", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Informar nota")
    fireEvent.change(screen.getByRole("textbox", { name: /Versão R18/ }), { target: { value: "8,3" } })
    expect(screen.getByText("De 0 a 10, de 0,5 em 0,5.")).toBeTruthy()
    expect(salvar().disabled).toBe(true)
  })

  it("obra SEM decisão não vira 'uma edição só' por acidente: só grava depois de escolher", async () => {
    await abrir({ ...base, state: null, decidedBy: null, basis: null, decidedAt: null, scores: {} })
    expect(screen.getByText("Sem decisão — tratada como versão única")).toBeTruthy()
    expect(salvar().disabled).toBe(true)
    expect(screen.queryByText(/Nota de conteúdo adulto por versão/)).toBeNull()

    escolher(screen.getByRole("combobox", { name: "Estado" }), "Versão normal + versão R18")
    // Visto no browser: o gatilho ficava VAZIO depois da escolha (o Select começava sem valor
    // controlado). A escolha valia — só não aparecia.
    expect(screen.getByRole("combobox", { name: "Estado" }).textContent).toContain("Versão normal + versão R18")
    expect(screen.getByText(/Nota de conteúdo adulto por versão/)).toBeTruthy()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(salvar())
    await waitFor(() =>
      expect(saveWorkEditionCuration).toHaveBeenCalledWith("obra-1", {
        state: "mixed",
        r18ExtraChapters: true,
        scores: { normal: { kind: "manter" }, r18: { kind: "manter" } },
      }),
    )
  })

  it("com 'Marcar como 18+' ligado, avisa que ele vence o estado", async () => {
    await abrir({ ...base, adultOverride: true })
    expect(screen.getByText(/marcada como 18\+ à mão, e isso vence o estado das versões/)).toBeTruthy()
  })

  it("fora de mixed, as notas por edição somem e o diálogo diz que elas ficam guardadas", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Estado" }), "Só versão R18")
    expect(screen.queryByText(/Nota de conteúdo adulto por versão/)).toBeNull()
    expect(screen.getByText(/ficam guardadas e só voltam a valer/)).toBeTruthy()
    expect(screen.getByText("A obra inteira é 18+.")).toBeTruthy()
  })

  it("decisão da auditoria: não há 'Remover decisão' (não é da curadoria)", async () => {
    await abrir(base)
    expect(screen.queryByRole("button", { name: "Remover decisão da curadoria" })).toBeNull()
  })

  it("decisão da curadoria: mostra para onde volta e remove com um clique", async () => {
    await abrir(curada)
    expect(screen.getByText("Volta para: Versão normal + versão R18 (auditoria).")).toBeTruthy()
    expect(screen.getByText("As notas por versão ficam como estão.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remover decisão da curadoria" }))
    await waitFor(() => expect(revertWorkEditionCuration).toHaveBeenCalledWith("obra-1"))
    expect(saveWorkEditionCuration).not.toHaveBeenCalled()
  })

  it("com mudanças não salvas, remover fica travado (não mistura as duas ações)", async () => {
    await abrir(curada)
    escolher(screen.getByRole("combobox", { name: "Estado" }), "Só versão R18")
    const botao = screen.getByRole("button", { name: "Remover decisão da curadoria" }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(screen.getByText("Descarte as mudanças acima para remover a decisão.")).toBeTruthy()
  })

  it("decisão da curadoria sem registro do estado anterior: botão desligado, com o porquê", async () => {
    await abrir({ ...curada, canRevert: false, revertTarget: "Esta decisão não guardou o estado anterior, então não há para onde voltar." })
    expect((screen.getByRole("button", { name: "Remover decisão da curadoria" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/não guardou o estado anterior/)).toBeTruthy()
  })
})

/**
 * A nota por versão é uma nota de critério (Conteúdo Adulto, 0–10) e se dá pelo MESMO controle da
 * avaliação pós-leitura: a linha do critério com o rótulo da faixa ao vivo e o painel da faixa. Antes era
 * um campo de texto solto ao lado do seletor, sem dizer de que critério era nem o que a nota significa.
 */
describe("nota por versão — o mesmo controle da nota de critério", () => {
  it("'Informar nota' abre a linha de Conteúdo Adulto e o painel da faixa; 'Manter como está' não", async () => {
    await abrir(base)
    expect(screen.queryByText("Conteúdo Adulto")).toBeNull()
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Informar nota")
    expect(screen.getByText("Conteúdo Adulto")).toBeTruthy()
    expect(screen.getByText("Informe a nota para ver o que a faixa significa.")).toBeTruthy()
  })

  it("a faixa da rubrica acompanha o valor digitado, na linha e no painel", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Informar nota")
    const campo = screen.getByRole("textbox", { name: /Versão R18/ })
    fireEvent.change(campo, { target: { value: "9" } })
    const faixa = bandForScore(9)
    const titulo = rubricTitle("adult_content", faixa)!
    expect(screen.getAllByText(titulo)).toHaveLength(2) // rótulo na linha + painel
    expect(screen.getByText(faixa)).toBeTruthy()
    fireEvent.change(campo, { target: { value: "5,5" } })
    expect(screen.getAllByText(rubricTitle("adult_content", bandForScore(5.5))!)).toHaveLength(2)
  })

  it("nota inválida: sem faixa na linha, painel em espera e Salvar travado", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Informar nota")
    fireEvent.change(screen.getByRole("textbox", { name: /Versão R18/ }), { target: { value: "8,3" } })
    expect(screen.queryByText(rubricTitle("adult_content", bandForScore(8))!)).toBeNull()
    expect(screen.getByText("Informe a nota para ver o que a faixa significa.")).toBeTruthy()
    expect(salvar().disabled).toBe(true)
  })

  it("o contrato de gravação não mudou: R18 '9' grava { kind: 'nota', value: 9 } e a normal fica 'manter'", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Informar nota")
    fireEvent.change(screen.getByRole("textbox", { name: /Versão R18/ }), { target: { value: "9" } })
    fireEvent.click(salvar())
    await waitFor(() =>
      expect(saveWorkEditionCuration).toHaveBeenCalledWith("obra-1", {
        state: "mixed",
        r18ExtraChapters: false,
        scores: { normal: { kind: "manter" }, r18: { kind: "nota", value: 9 } },
      }),
    )
  })

  it("'Marcar como não avaliado' grava { kind: 'nao_avaliado' } e não abre campo nem painel", async () => {
    await abrir(base)
    escolher(screen.getByRole("combobox", { name: "Nota da Versão R18" }), "Marcar como não avaliado")
    expect(screen.queryByRole("textbox", { name: /Versão R18/ })).toBeNull()
    expect(screen.queryByText("Conteúdo Adulto")).toBeNull()
    fireEvent.click(salvar())
    await waitFor(() =>
      expect(saveWorkEditionCuration).toHaveBeenCalledWith("obra-1", {
        state: "mixed",
        r18ExtraChapters: false,
        scores: { normal: { kind: "manter" }, r18: { kind: "nao_avaliado" } },
      }),
    )
  })

  it("a pós-leitura e a nota por versão usam a MESMA linha e o MESMO painel — não há uma terceira cópia", () => {
    for (const f of ["components/titles/post-attribute-assessment-form.tsx", "components/titles/work-editions-dialog.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8")
      expect(src, f).toMatch(/import \{ CriterionBandReadout, CriterionScoreRow \} from "@\/components\/titles\/criterion-score-row"/)
      expect(src, f).toMatch(/<CriterionScoreRow/)
      expect(src, f).not.toMatch(/function BandReadout/)
    }
  })
})
