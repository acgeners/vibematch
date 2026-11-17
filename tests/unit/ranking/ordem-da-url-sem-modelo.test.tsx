import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react"

vi.mock("server-only", () => ({}))

let urlAtual = ""
const nav = { replace: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(urlAtual),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

import { RankingFilters } from "@/components/ranking/ranking-filters"
import { activeSortFieldFor, isSortFieldAvailable } from "@/lib/ranking/sort-basis"
import type { SortBasis } from "@/lib/ranking/sort-basis"
import { LABELS } from "@/lib/constants/ui-labels"
import { CHANCE_LABELS } from "@/lib/calculations/forces"

/**
 * Sem modelo (menos de 20 notas), a consulta ordena pelo Alinhamento mesmo quando a URL pede
 * "N. Prevista" (`effectiveSortLevels`). O #636 converteu só a ordenação PADRÃO; com
 * `sort=expected_score` vindo de um link ou de um filtro salvo, o painel ainda dizia
 * "N. Prevista", e a tabela agrupava em tiers pela Prevista e marcava a coluna dela.
 */

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  urlAtual = ""
})

describe("o campo que ordena de fato", () => {
  it("sem modelo, o eixo do modelo vira o Alinhamento; sem tags, a média externa", () => {
    expect(activeSortFieldFor("expected_score:desc,year:asc", "alignment")).toBe("personal_fit")
    expect(activeSortFieldFor("decision:desc", "alignment")).toBe("personal_fit")
    expect(activeSortFieldFor("expected_score:desc", "platform")).toBe("platform_avg")
    expect(activeSortFieldFor("personal_fit:desc", "platform")).toBe("platform_avg")
  })

  it("com modelo, ou num campo que não depende dele, nada muda", () => {
    expect(activeSortFieldFor("expected_score:desc", "expected")).toBe("expected_score")
    expect(activeSortFieldFor("title:asc,year:desc", "alignment")).toBe("title")
    expect(activeSortFieldFor("crit_romance:desc", "platform")).toBe("crit_romance")
  })

  it("um campo só é oferecido quando ordena por ele mesmo", () => {
    for (const f of ["expected_score", "decision", "chance_score", "recommended", "art", "alignment_score"]) {
      expect(isSortFieldAvailable(f, "alignment"), f).toBe(false)
      expect(isSortFieldAvailable(f, "expected"), f).toBe(true)
    }
    expect(isSortFieldAvailable("personal_fit", "alignment")).toBe(true)
    expect(isSortFieldAvailable("personal_fit", "platform")).toBe(false)
    for (const f of ["platform_avg", "year", "title", "crit_romance"]) {
      expect(isSortFieldAvailable(f, "platform"), f).toBe(true)
    }
  })
})

function renderPainel(sortBasis: SortBasis, url: string) {
  urlAtual = url
  return render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort="personal_fit:desc,platform_avg:desc"
      sortBasis={sortBasis}
    />,
  )
}

function abrirNivel1() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Nível 1 de ordenação" }), { key: " " })
  return screen.getByRole("listbox")
}

describe("o painel mostra a ordenação que vale, não a que a URL pediu", () => {
  it("sem modelo, `sort=expected_score` aparece como Alinhamento, desempatado pela média externa", () => {
    renderPainel("alignment", "sort=expected_score:desc")
    expect(screen.getByRole("button", { name: `${LABELS.personal_fit.short}: ordem decrescente` })).toBeTruthy()
    expect(screen.getByRole("button", { name: `${LABELS.platform_avg.short}: ordem decrescente` })).toBeTruthy()
    expect(screen.queryByRole("button", { name: new RegExp(`^${LABELS.expected_score.short}: ordem`) })).toBeNull()
    expect(screen.getByText("2 níveis")).toBeTruthy()
  })

  it("contraprova: com modelo, a mesma URL segue em N. Prevista", () => {
    renderPainel("expected", "sort=expected_score:desc")
    expect(screen.getByRole("button", { name: `${LABELS.expected_score.short}: ordem decrescente` })).toBeTruthy()
  })

  it("sem modelo, o seletor não oferece o que ordenaria por outro campo", () => {
    renderPainel("alignment", "sort=expected_score:desc")
    const nomes = within(abrirNivel1())
      .getAllByRole("option")
      .map((o) => o.textContent?.trim())
    for (const ausente of [
      LABELS.expected_score.short,
      LABELS.decision.short,
      LABELS.alignment_score.short,
      CHANCE_LABELS.full,
      "Recomendado",
      "Arte (est.)",
    ]) {
      expect(nomes, ausente).not.toContain(ausente)
    }
    expect(nomes).toContain(LABELS.personal_fit.short)
    expect(nomes).toContain(LABELS.platform_avg.short)
  })

  it("sem modelo, '+ nível' acrescenta um campo que ordena por ele mesmo", () => {
    // Se o próximo campo livre fosse "Recomendado", ele viraria Alinhamento, repetiria o 1º nível
    // e sumiria: o clique não faria nada visível.
    renderPainel("alignment", "sort=personal_fit:desc,platform_avg:desc")
    expect(screen.getByText("2 níveis")).toBeTruthy()
    fireEvent.click(screen.getByText("+ nível"))
    expect(screen.getByText("3 níveis")).toBeTruthy()
  })

  it("um grupo que ficou sem opção não aparece vazio", () => {
    renderPainel("alignment", "")
    const listbox = abrirNivel1()
    const grupos = Array.from(listbox.querySelectorAll('[data-slot="select-label"]')).map((n) =>
      n.querySelector("span")?.textContent?.trim(),
    )
    // "Recomendação" só tem `recommended` e `decision`, os dois do modelo.
    expect(grupos).toEqual(["Notas", "Básico", "Atributos"])
  })

  it("contraprova: com modelo, o seletor oferece N. Prevista e os 4 grupos", () => {
    renderPainel("expected", "")
    const listbox = abrirNivel1()
    const nomes = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim())
    expect(nomes).toContain(LABELS.expected_score.short)
    expect(listbox.querySelectorAll('[data-slot="select-label"]')).toHaveLength(4)
  })
})
