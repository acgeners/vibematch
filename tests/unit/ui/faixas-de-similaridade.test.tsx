import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react"
import {
  SIMILARITY_BANDS,
  formatSimilarity,
  similarityBand,
  similarityPercent,
  similarityBandLevel,
  similarityBandRange,
} from "@/lib/ui/similarity-band"
import { SimilarWorksCard } from "@/components/titles/similar-works-card"
import type { SimilarWork } from "@/server/queries/similar-works"

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

function obra(id: string, title: string, similarity: number): SimilarWork {
  return {
    id,
    title,
    similarity,
    coverUrls: [],
    synopsis: null,
    expectedScore: 7.5,
    personalFit: null,
    personalFitPercentile: null,
    userScore: null,
    genres: [],
    year: 2025,
    totalChapters: 50,
    publicationStatusId: null,
    personalStatusId: null,
    isAdult: false,
    isMixed: false,
    platformAvg: null,
    totalVotes: null,
    alignmentScore: null,
    alignmentStale: false,
    synopsisQuality: null,
    synopsisFromPrediction: false,
    predictedSynopsisQuality: null,
    predictedSynopsisStale: false,
  }
}

describe("os cinco grupos de similaridade", () => {
  it("os cortes separam os grupos nas bordas, com o piso inclusivo", () => {
    expect(similarityBand(0.66).id).toBe("muito")
    expect(similarityBand(0.42).id).toBe("muito")
    expect(similarityBand(0.4149).id).toBe("bem")
    expect(similarityBand(0.37).id).toBe("bem")
    expect(similarityBand(0.3649).id).toBe("parecida")
    expect(similarityBand(0.33).id).toBe("parecida")
    expect(similarityBand(0.3249).id).toBe("algo")
    expect(similarityBand(0.29).id).toBe("algo")
    expect(similarityBand(0.2849).id).toBe("pouco")
    // Na escala centralizada a similaridade pode ser negativa: cai no último grupo, sem estourar.
    expect(similarityBand(-0.1).id).toBe("pouco")
  })

  it("o grupo lê o MESMO % que a tela imprime, não o decimal cru", () => {
    // Medido no app em 16/11: 41,99% saía "42%" no tooltip e caía em "Bem parecida",
    // enquanto a legenda dizia que 42% já é "Muito parecida".
    expect(formatSimilarity(0.4199)).toBe("42%")
    expect(similarityBand(0.4199).id).toBe("muito")
    for (let i = -100; i <= 700; i++) {
      const v = i / 1000
      const shown = similarityPercent(v)
      const band = similarityBand(v)
      const idx = SIMILARITY_BANDS.indexOf(band)
      const teto = idx > 0 ? SIMILARITY_BANDS[idx - 1].min : null
      if (band.min != null) expect(shown).toBeGreaterThanOrEqual(band.min)
      if (teto != null) expect(shown).toBeLessThan(teto)
    }
  })

  it("os cortes descem, e só o último grupo não tem piso", () => {
    const pisos = SIMILARITY_BANDS.map((b) => b.min)
    expect(pisos.at(-1)).toBeNull()
    const comPiso = pisos.slice(0, -1) as number[]
    expect(comPiso.every((v) => typeof v === "number")).toBe(true)
    expect([...comPiso].sort((a, b) => b - a)).toEqual(comPiso)
  })

  it("a faixa impressa sai dos cortes, nos dois extremos e no meio", () => {
    expect(SIMILARITY_BANDS.map(similarityBandRange)).toEqual([
      "42% ou mais",
      "37% a 41%",
      "33% a 36%",
      "29% a 32%",
      "abaixo de 29%",
    ])
  })

  it("o nível vai de N (mais parecida) a 1, um por grupo", () => {
    expect(SIMILARITY_BANDS.map(similarityBandLevel)).toEqual([5, 4, 3, 2, 1])
  })

  it("as partes medidas somam ~100% (arredondamento)", () => {
    const soma = SIMILARITY_BANDS.reduce((acc, b) => acc + Number.parseInt(b.share, 10), 0)
    expect(soma).toBeGreaterThanOrEqual(99)
    expect(soma).toBeLessThanOrEqual(101)
  })

  it("cada grupo tem cor própria, e nenhuma é âmbar, vermelho ou verde", () => {
    // Âmbar é o "desatualizado" do app; vermelho/verde leriam como julgamento e o verde
    // colidiria com o selo da Prevista, que fica na mesma coluna.
    const chips = SIMILARITY_BANDS.map((b) => b.chipClass)
    const barras = SIMILARITY_BANDS.map((b) => b.barClass)
    expect(new Set(chips).size).toBe(SIMILARITY_BANDS.length)
    expect(new Set(barras).size).toBe(SIMILARITY_BANDS.length)
    for (const c of [...chips, ...barras]) {
      expect(c).not.toMatch(/\b(?:bg|text)-(?:amber|yellow|orange|red|rose|green|emerald|lime)-/)
    }
  })
})

describe("o card mostra o GRUPO, não o % cru", () => {
  const works = [
    obra("a", "The Swindler Couple of Ardel", 0.357),
    obra("b", "The Possessive Tyrant and His Sleepy Cat", 0.513),
    obra("c", "The Villainess Flips the Script", 0.27),
  ]

  it("cada linha traz o nome do grupo; o % fica no rótulo acessível, fora do texto", () => {
    render(<SimilarWorksCard works={works} />)
    expect(screen.getByText("Parecida")).toBeTruthy()
    expect(screen.getByText("Muito parecida")).toBeTruthy()
    expect(screen.getByText("Pouco em comum")).toBeTruthy()
    // O número só aparece ao passar o mouse (tooltip fechado não monta).
    expect(screen.queryByText("36%")).toBeNull()
    expect(screen.getByRole("button", { name: "Similaridade 36%: Parecida" })).toBeTruthy()
  })

  it("a barra acende tantos segmentos quanto o nível do grupo", () => {
    render(<SimilarWorksCard works={[works[0]]} />)
    const gatilho = screen.getByRole("button", { name: "Similaridade 36%: Parecida" })
    const segmentos = gatilho.querySelectorAll("[aria-hidden] > span")
    expect(segmentos).toHaveLength(SIMILARITY_BANDS.length)
    const acesos = [...segmentos].filter((s) => s.className.includes(similarityBand(0.357).barClass))
    expect(acesos).toHaveLength(3)
  })

  it("a legenda nasce recolhida e abre pelo 'Como ler'", () => {
    render(<SimilarWorksCard works={works} />)
    const botao = screen.getByRole("button", { name: /como ler/i })
    expect(botao.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Legenda das informações:")).toBeNull()

    fireEvent.click(botao)

    expect(botao.getAttribute("aria-expanded")).toBe("true")
    const legenda = document.getElementById("similar-works-legend")
    expect(legenda).not.toBeNull()
    const dentro = within(legenda as HTMLElement)
    for (const band of SIMILARITY_BANDS) {
      expect(dentro.getByText(band.label)).toBeTruthy()
      expect(dentro.getByText(similarityBandRange(band))).toBeTruthy()
    }

    fireEvent.click(botao)
    expect(screen.queryByText("Legenda das informações:")).toBeNull()
  })
})
