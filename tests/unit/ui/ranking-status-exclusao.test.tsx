import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const nav = { replace: vi.fn() }
let currentQuery = ""
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(currentQuery),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

import { RankingFilters } from "@/components/ranking/ranking-filters"

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

/** Cores e símbolos reais das tabelas de status (o `？` do Unknown incluído). */
const PUBLICATION = [
  { id: 1, slug: "completed", status: "Completed", color: "#22C55E", symbol: "✅", comment: null },
  { id: 2, slug: "ongoing", status: "Ongoing", color: "#3B82F6", symbol: "🔄", comment: null },
  { id: 3, slug: "hiatus", status: "Hiatus", color: "#F59E0B", symbol: "⏸️", comment: null },
  { id: 4, slug: "cancelled", status: "Cancelled", color: "#EF4444", symbol: "⛔", comment: null },
  { id: 5, slug: "unknown", status: "Unknown", color: null, symbol: "？", comment: null },
]
const PERSONAL = [
  { id: 1, slug: "want-to-read", status: "Want to Read", color: "#A3E635", symbol: "⭐️", comment: null },
  { id: 3, slug: "reading", status: "Reading", color: "#60A5FA", symbol: "📖", comment: null },
  { id: 11, slug: "untracked", status: "Untracked", color: "#9CA3AF", symbol: "⎯", comment: null },
]

/**
 * Exclusão de status, em RENDER de propósito.
 *
 * `status-filter-exclusion.test.ts` já cobre a semântica dos parâmetros e passaria
 * verde com a zona `−` não ligada em lugar nenhum — foi exatamente assim que o
 * controle "Meu range" e o badge do chrome regrediram antes. O que regride nesta
 * classe é o ESCOPO: se o alvo existe, o que ele escreve na URL, e como o estado
 * excluído aparece na tela.
 */
function renderFilters(query = "") {
  currentQuery = query
  const r = render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort="expected_score:desc"
      publicationStatuses={PUBLICATION}
      personalStatuses={PERSONAL}
      defaultPublicationStatus="all"
      defaultPersonalStatus="all"
    />
  )
  // A zona `−` é MODO, desligado por padrão (ver o describe "o modo de exclusão…").
  // Uma URL que já traz exclusão acende o modo sozinha; sem ela, os casos abaixo
  // precisam ligá-lo — é o gesto que a pessoa faz antes de excluir qualquer coisa.
  ligarModoExcluir()
  return r
}

/** Liga o modo de exclusão nos dois cards, se ainda não estiver ligado. */
function ligarModoExcluir() {
  for (const dimensao of ["de publicação", "pessoais"]) {
    const btn = screen.queryByRole("button", {
      name: `Excluir status ${dimensao} em vez de selecionar`,
    })
    if (btn) fireEvent.click(btn)
  }
}

/**
 * A URL que o painel escreveu — depois de "Aplicar filtros".
 *
 * ⚠️ O painel é RASCUNHO: `updateParams` escreve em `draftSearch` e SÓ o "Aplicar"
 * navega (ver CLAUDE.md, "O painel de filtros é RASCUNHO"). Ler `router.replace` logo
 * após o clique no `−` não devolve nada — a mudança existe, só não navegou ainda.
 */
function applyAndRead(): URLSearchParams {
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }))
  const url = nav.replace.mock.calls.at(-1)?.[0] as string
  return new URLSearchParams((url ?? "").split("?")[1] ?? "")
}

/** A zona `−` do status, esteja ele excluído ou não (o rótulo do alvo muda com o estado). */
function excludeButton(name: string): HTMLElement {
  return (
    screen.queryByRole("button", { name: `Excluir ${name}` }) ??
    screen.getByRole("button", { name: `Parar de excluir ${name}` })
  )
}

/** O chip do status pelo nome (o container que tem a zona − e o rótulo). */
function statusChip(name: string): HTMLElement {
  return excludeButton(name).closest("div") as HTMLElement
}

afterEach(() => {
  cleanup()
  nav.replace.mockClear()
  currentQuery = ""
})

/**
 * O modo de exclusão, em RENDER — e este bloco NÃO usa `renderFilters`, que liga o modo
 * por conveniência dos demais. Aqui o que está sendo medido é justamente o estado
 * inicial.
 */
describe("o modo de exclusão nasce desligado e não esconde filtro", () => {
  function renderCru(query = "") {
    currentQuery = query
    return render(
      <RankingFilters
        availableGenres={[]}
        availableTags={[]}
        defaultTopN={40}
        defaultSort="expected_score:desc"
        publicationStatuses={PUBLICATION}
        personalStatuses={PERSONAL}
        defaultPublicationStatus="all"
        defaultPersonalStatus="all"
      />
    )
  }

  it("sem modo ligado, nenhum pill oferece a zona −", () => {
    renderCru()
    expect(screen.queryByRole("button", { name: "Excluir Cancelled" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Excluir Want to Read" })).toBeNull()
    // …e o pill continua sendo clicável para SELECIONAR, que é o uso comum.
    expect(screen.getByText("Cancelled").closest("button")).toBeTruthy()
  })

  it("ligar o modo de um card não liga o do outro", () => {
    renderCru()
    fireEvent.click(
      screen.getByRole("button", { name: "Excluir status de publicação em vez de selecionar" })
    )
    expect(screen.getByRole("button", { name: "Excluir Cancelled" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Excluir Want to Read" })).toBeNull()
  })

  /**
   * 🔴 Exclusão vinda de FORA do painel — preset salvo, link colado, voltar do browser —
   * tem que acender o controle. Se o modo fosse só state, o filtro estaria valendo com
   * a zona `−` invisível: filtro ativo sem nada na tela que o explique, que é o que o
   * badge "Todos" já é obrigado a evitar.
   */
  it("URL que já traz exclusão acende o modo sozinha", () => {
    renderCru("pub_status_exclude=Cancelled")
    expect(screen.getByRole("button", { name: "Parar de excluir Cancelled" })).toBeTruthy()
    // e só o card daquela dimensão
    expect(screen.queryByRole("button", { name: "Excluir Want to Read" })).toBeNull()
  })

  it("desligar o modo remove as exclusões daquela dimensão", () => {
    renderCru("pub_status_exclude=Cancelled&per_status_exclude=Reading")
    fireEvent.click(
      screen.getByRole("button", { name: "Sair do modo excluir status de publicação (remove a exclusão)" })
    )
    const q = applyAndRead()
    expect(q.get("pub_status_exclude")).toBeNull()
    // a outra dimensão não é tocada — cada card tem o seu interruptor
    expect(q.get("per_status_exclude")).toBe("Reading")
  })

  it("desligado, a zona − some junto com a exclusão", () => {
    renderCru("pub_status_exclude=Cancelled")
    fireEvent.click(
      screen.getByRole("button", { name: "Sair do modo excluir status de publicação (remove a exclusão)" })
    )
    expect(screen.queryByRole("button", { name: "Parar de excluir Cancelled" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Excluir Cancelled" })).toBeNull()
  })
})

describe("a zona − existe e escreve o par de parâmetros", () => {
  it("cada pill de status oferece excluir", () => {
    renderFilters()
    expect(screen.getByRole("button", { name: "Excluir Cancelled" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Excluir Want to Read" })).toBeTruthy()
  })

  it("excluir escreve pub_status_exclude e limpa a lista positiva", () => {
    renderFilters("pub_status=Completed,Ongoing")
    fireEvent.click(excludeButton("Cancelled"))
    const q = applyAndRead()
    expect(q.get("pub_status_exclude")).toBe("Cancelled")
    expect(q.get("pub_status")).toBeNull()
  })

  it("o status pessoal usa o SEU par, sem tocar no de publicação", () => {
    renderFilters("pub_status_exclude=Cancelled")
    fireEvent.click(excludeButton("Reading"))
    const q = applyAndRead()
    expect(q.get("per_status_exclude")).toBe("Reading")
    expect(q.get("pub_status_exclude")).toBe("Cancelled")
  })

  it("clicar de novo no − desfaz a exclusão", () => {
    renderFilters("pub_status_exclude=Cancelled")
    fireEvent.click(excludeButton("Cancelled"))
    expect(applyAndRead().get("pub_status_exclude")).toBeNull()
  })
})

describe("o estado excluído aparece na tela — e não como cor", () => {
  /**
   * 🔴 A regressão silenciosa desta feature: pintar o excluído de vermelho. Cada status
   * tem cor própria (`Cancelled` já é `#EF4444`), então "excluído = vermelho" some
   * justamente no status que mais se exclui. A marca tem que ser FORMA.
   */
  it("o rótulo do status excluído vem riscado", () => {
    renderFilters("pub_status_exclude=Cancelled")
    const risked = within(statusChip("Cancelled")).getByText("Cancelled")
    expect(risked.className).toContain("line-through")
  })

  it("status não excluído não vem riscado", () => {
    renderFilters("pub_status_exclude=Cancelled")
    const plain = within(statusChip("Ongoing")).getByText("Ongoing")
    expect(plain.className).not.toContain("line-through")
  })

  /**
   * 🔴 A regressão que este bloco tranca: excluir UM status apagava a cor dos outros
   * quatro. `selected*` é esvaziado no modo negativo (a barra de "Filtros ativos" não
   * pode listar uma inclusão ao lado do chip "exceto") e os pills liam esse mesmo
   * conjunto — a tela dizia "perdi minha seleção" no clique em que o filtro passou a
   * incluir MAIS obras. Marcado = está no resultado, então "todos menos os riscados".
   */
  it("excluindo, os outros pills continuam marcados — só o excluído não", () => {
    renderFilters("pub_status_exclude=Cancelled")
    for (const { status } of PUBLICATION) {
      const label = within(statusChip(status)).getByText(status)
      expect(label.closest("button")?.getAttribute("aria-pressed")).toBe(
        status === "Cancelled" ? "false" : "true"
      )
    }
  })

  /**
   * 🔴 O gesto tem que acompanhar a marca. Com o pill marcado, `"include"` (o clique de
   * antes, quando nenhum ficava marcado) faz `setStatusRule` sair da exclusão com a
   * lista positiva VAZIA — que é a forma canônica do `"all"`. Ou seja: clicar em
   * "Ongoing" para TIRÁ-LO acenderia os cinco.
   */
  it("clicar no nome de um pill marcado o exclui, em vez de acender todos", () => {
    renderFilters("pub_status_exclude=Cancelled")
    fireEvent.click(within(statusChip("Ongoing")).getByText("Ongoing"))
    const q = applyAndRead()
    expect(q.get("pub_status_exclude")).toBe("Cancelled,Ongoing")
    expect(q.get("pub_status")).toBeNull()
  })

  it("clicar no nome do pill riscado desfaz a exclusão dele", () => {
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    fireEvent.click(within(statusChip("Hiatus")).getByText("Hiatus"))
    expect(applyAndRead().get("pub_status_exclude")).toBe("Cancelled")
  })

  /**
   * Sem exclusão nenhuma o card volta a ser positivo: o clique no nome SELECIONA (e
   * some com os defaults da página), que é o uso comum e não pode ter mudado.
   */
  it("sem exclusão, o clique no nome continua selecionando", () => {
    renderFilters("pub_status=Completed")
    fireEvent.click(within(statusChip("Ongoing")).getByText("Ongoing"))
    const q = applyAndRead()
    expect(q.get("pub_status")).toBe("Completed,Ongoing")
    expect(q.get("pub_status_exclude")).toBeNull()
  })

  /**
   * Símbolo que não desenha nada além do rótulo é ruído: o `？` de "Unknown" e o traço
   * `⎯` de "Untracked" — os dois vêm do banco. Os que DIZEM algo continuam.
   */
  it.each([["Unknown"], ["Untracked"]])("o pill de %s não mostra símbolo", (status) => {
    renderFilters()
    const label = within(statusChip(status)).getByText(status)
    expect(label.closest("button")?.textContent).toBe(status)
  })

  it("os símbolos informativos continuam", () => {
    renderFilters()
    expect(within(statusChip("Completed")).getByText("Completed").closest("button")?.textContent).toContain("✅")
    expect(within(statusChip("Reading")).getByText("Reading").closest("button")?.textContent).toContain("📖")
  })

  it('o cabeçalho conta as exclusões, não a seleção', () => {
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    expect(screen.getByText("Publicação (exceto 2)")).toBeTruthy()
  })

  /**
   * O badge "Todos" promete o catálogo inteiro. Se ele apagasse só o positivo, a
   * exclusão continuaria de pé por baixo dele — filtro invisível, badge mentindo.
   * (`pub_status` pode sair como `"all"` ou ausente; as duas formas são "sem
   * restrição" — o que não pode sobrar é a exclusão.)
   */
  it('"Todos" zera a exclusão junto', () => {
    renderFilters("pub_status_exclude=Cancelled")
    fireEvent.click(screen.getAllByText("Todos")[0])
    const q = applyAndRead()
    expect(q.get("pub_status_exclude")).toBeNull()
    expect([null, "all"]).toContain(q.get("pub_status"))
  })
})

describe("a barra de filtros ativos", () => {
  it("mostra UM chip por dimensão, com o valor riscado", () => {
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    expect(screen.getByText("Publicação exceto")).toBeTruthy()
    const bar = screen.getByText("Filtros ativos").parentElement as HTMLElement
    // Um chip só, não um por valor excluído.
    expect(within(bar).queryAllByText("Publicação exceto")).toHaveLength(1)
    const value = within(bar).getByRole("button", { name: "Remover Cancelled" })
    expect(value.className).toContain("line-through")
  })

  it("o contador conta VALORES — agrupar não pode fazer filtro sumir", () => {
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    expect(screen.getByText("2 seleções")).toBeTruthy()
  })

  it("remover um valor tira só ele; o ✕ do chip zera o controle", () => {
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    fireEvent.click(screen.getByRole("button", { name: "Remover Hiatus" }))
    expect(applyAndRead().get("pub_status_exclude")).toBe("Cancelled")

    cleanup()
    nav.replace.mockClear()
    renderFilters("pub_status_exclude=Cancelled,Hiatus")
    fireEvent.click(screen.getByRole("button", { name: "Remover o filtro Publicação exceto" }))
    expect(applyAndRead().get("pub_status_exclude")).toBeNull()
  })

  it("a inclusão também vira um chip só, com os valores dentro", () => {
    renderFilters("per_status=Want to Read,Untracked")
    const bar = screen.getByText("Filtros ativos").parentElement as HTMLElement
    expect(within(bar).getByText("Status")).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Remover Want to Read" })).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Remover Untracked" })).toBeTruthy()
  })
})
