import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
// O painel de filtros lê a URL; aqui ele não é o assunto.
vi.mock("@/components/ai-evaluation/ai-evaluation-filters", () => ({
  AiEvaluationFilters: () => null,
}))
// O diálogo monta o SourceSelectionStep, que dispara a busca externa no mount.
vi.mock("@/components/ai-evaluation/source-link-dialog", () => ({
  SourceLinkDialog: () => null,
}))

import { render, screen, within } from "@testing-library/react"
import { SourcesTab } from "@/components/ai-evaluation/sources-tab"
import { SELECTABLE_EXTERNAL_SOURCES } from "@/lib/external/source-order"
import { sourceLabel } from "@/lib/external/source-labels"
import type { SourceGapWork } from "@/server/queries/works-without-sources"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * Aba "Fontes" — teste de RENDER de propósito. O que regride nesta aba não é o cálculo
 * (esse está medido contra o SQL): é a árvore desenhada deixar de consumir a lista.
 *
 * Os dois defeitos que ele existe pra pegar:
 *
 * 🔴 **O mapa por fonte encolher junto com o filtro.** Os números dos chips são do
 * catálogo INTEIRO. Se eles passarem a contar só a lista filtrada, clicar em "Kitsu"
 * zera os outros oito e a única saída visível vira limpar o filtro — a aba deixa de ser
 * um mapa e vira um beco.
 *
 * 🔴 **O card contar as lacunas em vez de NOMEÁ-LAS.** "faltam 3" não diz se é trabalho
 * de minutos ou uma fonte que não indexa esse tipo de obra; é o nome que decide se vale
 * abrir a fila.
 */

const [S0, S1, S2] = SELECTABLE_EXTERNAL_SOURCES as readonly ExternalSourceId[]

function work(over: Partial<SourceGapWork> = {}): SourceGapWork {
  return {
    id: "w1",
    title: "The Beast I Chose",
    coverUrl: null,
    publicationStatusId: 2,
    hiatusKind: null,
    hiatusKindConfidence: null,
    publicationStatusNote: null,
    personalStatusId: 3,
    expectedScore: 8.1,
    isAdult: false,
    userScore: null,
    linked: [S2],
    absent: [],
    gaps: [S0, S1],
    usefulReviews: 12,
    tagCount: 30,
    ...over,
  }
}

const gapsBySource = SELECTABLE_EXTERNAL_SOURCES.map((source, i) => ({
  source: source as ExternalSourceId,
  missing: (i + 1) * 10,
}))

function renderTab(over: Partial<React.ComponentProps<typeof SourcesTab>> = {}) {
  return render(
    <SourcesTab
      works={[work()]}
      gapsBySource={gapsBySource}
      totalWorks={978}
      withGapsCount={629}
      activeSource={null}
      activePubStatuses={[]}
      activePersonalStatuses={[]}
      baseHref="/ai-evaluation?tab=fontes"
      {...over}
    />,
  )
}

describe("mapa por fonte", () => {
  it("mostra TODAS as fontes selecionáveis com o nº de obras sem vínculo", () => {
    renderTab()
    for (const { source, missing } of gapsBySource) {
      const chip = screen.getByTitle(new RegExp(`${missing} de 978 obras sem vínculo`))
      expect(chip).toBeTruthy()
      expect(chip.getAttribute("href")).toContain(`source=${source}`)
    }
  })

  /**
   * A fonte JÁ 100% coberta (Comix, hoje) continua no mapa, apagada. Escondê-la faria a
   * fila de chips mudar de tamanho conforme o trabalho anda — e "não aparece" viraria
   * indistinguível de "essa fonte saiu do app". Mesma razão pela qual o diálogo de
   * seleção sempre desenha as 9.
   *
   * ⚠️ Que os NÚMEROS não encolham com o filtro é invariante da query, não da árvore:
   * aqui eles chegam prontos como prop. Quem guarda aquilo é `source-gaps.test.ts`.
   */
  it("fonte com zero lacunas continua no mapa", () => {
    const semLacuna = gapsBySource.map((g, i) => (i === 1 ? { ...g, missing: 0 } : g))
    renderTab({ gapsBySource: semLacuna })
    const chip = screen.getByTitle(new RegExp(`^${sourceLabel(semLacuna[1].source)} — 0 de 978`))
    expect(chip).toBeTruthy()
  })

  it('"Qualquer uma" leva o tamanho real da fila e limpa o filtro de fonte', () => {
    renderTab({ activeSource: gapsBySource[0].source })
    const todas = screen.getByRole("link", { name: /Qualquer uma \(629\)/ })
    expect(todas.getAttribute("href")).toBe("/ai-evaluation?tab=fontes")
  })
})

describe("card da obra", () => {
  it("NOMEIA as fontes que faltam, não só conta", () => {
    renderTab()
    // ⚠️ Ancorado na string JUNTADA, e não em cada rótulo solto: os rótulos também
    // aparecem nos chips do mapa, então `toContain("MangaUpdates")` passaria verde com
    // o card imprimindo "faltam 2". Só o card junta os nomes com ", ".
    expect(screen.getByText([S0, S1].map(sourceLabel).join(", "))).toBeTruthy()
    // E a vinculada não entra nessa lista — senão "faltam" descreveria tudo.
    expect(screen.queryByText(new RegExp(`faltam.*${sourceLabel(S2)}`))).toBeNull()
  })

  it("marca evidência escassa abaixo do piso de reviews do digest", () => {
    renderTab({ works: [work({ usefulReviews: 1 })] })
    expect(screen.getByText(/evidência escassa/)).toBeTruthy()
  })

  it("não marca evidência escassa quando há reviews de sobra", () => {
    renderTab({ works: [work({ usefulReviews: 40 })] })
    expect(screen.queryByText(/evidência escassa/)).toBeNull()
  })

  it("mostra as fontes já decididas como ausentes sem contá-las como lacuna", () => {
    renderTab({ works: [work({ absent: [S2], linked: [] })] })
    expect(screen.getByText(/1 sem a obra/)).toBeTruthy()
    // O chip de estado conta só as lacunas.
    expect(screen.getByText("2 a checar")).toBeTruthy()
  })
})

describe("fila", () => {
  it("o botão de percorrer promete o tamanho da lista exibida", () => {
    renderTab({ works: [work(), work({ id: "w2", title: "Zenith" })] })
    expect(screen.getByRole("button", { name: /Percorrer a fila \(2\)/ })).toBeTruthy()
  })

  it("lista vazia com fonte filtrada explica QUAL fonte já está resolvida", () => {
    renderTab({ works: [], activeSource: S0 })
    const vazio = screen.getByText(/já tem o vínculo com/)
    expect(within(vazio).queryByText(/undefined/)).toBeNull()
    expect(vazio.textContent).toMatch(/já tem o vínculo com .+ avaliado/)
  })
})
