import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render } from "@testing-library/react"
import { WorkHeatmapView } from "@/components/titles/work-heatmap-view"
import type { WorkWithRelations } from "@/types/domain"

/**
 * O selo 🔞 18+ nas views DENSAS (2026-08-14).
 *
 * Ele já existia nos Cards, na prévia de hover, na /reading e no /discover — e
 * faltava exatamente onde a obra aparece como LINHA: Lista do /ranking, Lista do
 * /catalog e /favorites, matriz de atributos (esta) e Bússola. O modo de falha é o
 * mais barato de todos: some sem quebrar nada, e a tela continua plausível.
 *
 * Aqui é a matriz porque ela tem uma armadilha própria: a coluna 🔞 do heatmap é a
 * **nota** do critério `adult_content` (0–10, quanto a obra mostra), que é outro
 * fato — quem olha rápido acha que a classificação já está na tela.
 *
 * Teste de RENDER de propósito: um teste que lesse `work.is_adult` passaria verde
 * com o selo fora da árvore, que era exatamente o estado anterior.
 */

// O cabeçalho responsivo da matriz mede a coluna com `ResizeObserver`, que o jsdom
// não implementa (no browser existe desde sempre). Sem o stub o teste morre numa
// pilha de `commitLayoutEffect`, que não parece ter nada a ver com o selo.
if (typeof ResizeObserver === "undefined") {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Fixture mínima: a matriz lê `title`, `is_adult`, capas e as notas. O resto de
// `Work` é ~40 colunas que não participam desta decisão.
function obra(id: string, title: string, isAdult: boolean): WorkWithRelations {
  return {
    id,
    title,
    is_adult: isAdult,
    is_favorite: false,
    category_scores: [{ criterion_slug: "romance", score: 8 }],
    platform_ratings: [],
    calculated_scores: { expected_score: 8.2, alignment_score: 70 },
    tags: [],
    work_covers: [],
  } as unknown as WorkWithRelations
}

const OBRAS = [obra("a", "Obra comum", false), obra("b", "Obra adulta", true)]

describe("matriz de atributos — selo 18+", () => {
  it("marca a obra 18+ na coluna do título, e só ela", () => {
    const { container, unmount } = render(
      <WorkHeatmapView works={OBRAS} selectedIds={new Set()} onToggleSelect={() => {}} forceCriterionColumns />,
    )

    const selos = [...container.querySelectorAll("[title='Conteúdo adulto (18+)']")]
    expect(selos).toHaveLength(1)

    // Na LINHA da obra adulta, não numa coluna solta: a linha inteira é o que se lê.
    const linhaAdulta = selos[0].closest("tr")
    expect(linhaAdulta?.textContent).toContain("Obra adulta")
    expect(selos[0].textContent).toContain("18+")

    unmount()
  })
})
