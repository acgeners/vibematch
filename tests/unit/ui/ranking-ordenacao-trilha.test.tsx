import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const nav = { replace: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

import { RankingFilters } from "@/components/ranking/ranking-filters"

// O Select do Radix usa APIs de ponteiro que o jsdom não implementa — sem estes
// stubs abrir o menu lança `hasPointerCapture is not a function` e o teste falha
// por infraestrutura, não por regressão.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

/**
 * A ordenação do /ranking: TRILHA de chips (não pilha) e opções AGRUPADAS.
 *
 * De render de propósito. O que regride aqui é o TRATAMENTO: quantos elementos a
 * seção desenha por nível, e se o grupo de um campo novo existe. Um teste que
 * varresse `SORTABLE_FIELD_GROUPS` passaria com a seção renderizando a lista
 * corrida de antes.
 */
function renderFilters(sort?: string) {
  return render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort={sort ?? "expected_score:desc,alignment_score:desc"}
    />
  )
}

/** O card "Ordenação" — sobe do título até o container da seção. */
function sortCard(): HTMLElement {
  const title = screen.getByText("Ordenação")
  const card = title.closest("div")?.parentElement
  if (!card) throw new Error("card de Ordenação não encontrado")
  return card
}

afterEach(cleanup)

describe("trilha de ordenação", () => {
  it("desenha um chip por nível, com o separador de prioridade entre eles", () => {
    renderFilters("expected_score:desc,alignment_score:desc,year:asc")
    const card = sortCard()
    // 3 níveis → 2 separadores "›". A ordem esquerda→direita É o desempate; o
    // "›" diz isso melhor que a numeração "1. 2. 3." da pilha antiga.
    const seps = Array.from(card.querySelectorAll("span")).filter(
      (s) => s.textContent === "›" && s.getAttribute("aria-hidden") === "true"
    )
    expect(seps).toHaveLength(2)
    expect(screen.getByText("3 níveis")).toBeTruthy()
  })

  it("o botão de direção diz de QUAL campo ele é", () => {
    renderFilters("expected_score:desc,year:asc")
    // Sem o nome no aria-label, três botões "ordem decrescente" seriam
    // indistinguíveis pra quem navega por leitor de tela.
    expect(screen.getByRole("button", { name: /N\. Prevista: ordem decrescente/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Ano: ordem crescente/ })).toBeTruthy()
  })

  it("o ✕ some no último nível — botão que não pode agir lê como quebrado", () => {
    renderFilters("expected_score:desc")
    expect(screen.queryByRole("button", { name: /^Remover ordenação/ })).toBeNull()
    cleanup()
    renderFilters("expected_score:desc,year:asc")
    expect(screen.getAllByRole("button", { name: /^Remover ordenação/ })).toHaveLength(2)
  })

  it("no teto de 5 níveis o '+ nível' some", () => {
    renderFilters("expected_score:desc,alignment_score:desc,year:asc,title:asc,platform_avg:desc")
    expect(screen.getByText("5 níveis")).toBeTruthy()
    expect(screen.queryByText("+ nível")).toBeNull()
  })

  it("'+ nível' aparece abaixo do teto", () => {
    renderFilters("expected_score:desc")
    expect(screen.getByText("+ nível")).toBeTruthy()
  })

  it("vale também na variante SEM 'Obras exibidas'/'Largura dos tiers' (o /favorites)", () => {
    // Aquela combinação cai no ramo `roomy` do grid, que tem trilhas próprias —
    // e o /favorites é o único consumidor dela. Sem este caso, uma mudança nas
    // larguras poderia quebrar lá sem nada acusar aqui.
    render(
      <RankingFilters
        availableGenres={[]}
        availableTags={[]}
        defaultTopN={null}
        basePath="/favorites"
        showTopN={false}
        showTierBand={false}
        defaultSort="expected_score:desc,year:asc"
      />
    )
    expect(screen.getByText("2 níveis")).toBeTruthy()
    expect(screen.getAllByRole("combobox", { name: /Nível \d de ordenação/ })).toHaveLength(2)
  })
})

describe("opções agrupadas", () => {
  it("o seletor de um nível abre com os 4 grupos", () => {
    renderFilters("expected_score:desc")
    // Abre por TECLADO: o `pointerdown` do Radix depende de APIs de ponteiro que
    // o jsdom só finge ter, e o caminho de teclado exercita o mesmo conteúdo.
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Nível 1 de ordenação" }), {
      key: " ",
    })
    // ⚠️ Escopado ao LISTBOX, não ao documento: "Notas" e "Atributos" também são
    // nomes de aba/coluna na mesma tela, e um `getAllByText` solto passaria com o
    // seletor voltando à lista corrida — que é justamente a regressão.
    const listbox = screen.getByRole("listbox")
    const groupLabels = Array.from(listbox.querySelectorAll('[data-slot="select-label"]')).map(
      (n) => n.textContent?.trim(),
    )
    // Os três últimos grupos são os MESMOS do seletor de colunas — quem aprendeu
    // onde está "Veredito" ali acha aqui no mesmo lugar.
    expect(groupLabels).toEqual(["Recomendação", "Notas", "Básico", "Atributos"])

    // E os campos caem no grupo certo (o listbox lista os 26 numa ordem só).
    const optionNames = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim())
    expect(optionNames).toContain("Recomendado")
    expect(optionNames).toContain("Veredito")
    expect(optionNames).toContain("Tragédia")
  })
})
