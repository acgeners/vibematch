import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { MoodPreview, type MoodPreviewWork } from "@/components/ranking/mood-preview"
import { sortByMoodAdjusted, isMoodActive, type MoodRefine } from "@/lib/calculations/mood-refine"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * 🔴 A invariante: a prévia PROMETE uma ordem e a comparação tem que abrir NELA.
 *
 * Se a prévia recalcular por conta própria, as duas divergem — e quem confia na
 * promessa é exatamente quem está tentando decidir. Este teste compara a ordem
 * RENDERIZADA com a de `sortByMoodAdjusted`, o dono do cálculo.
 *
 * ⚠️ Em VÁRIOS moods, e isso é o ponto: com um só, duas fórmulas diferentes
 * coincidem por acaso — com 5 obras há poucas ordens possíveis. Os casos abaixo
 * exercitam cada tipo de entrada (par +, par −, chip em dobro, atributo −, e a
 * combinação), que é o que separa "passou" de "não testou nada".
 */

const ID = (nome: string) => {
  const id = getPublicationStatusIdByName(nome)
  if (id == null) throw new Error(`status "${nome}" não existe`)
  return id
}

const OBRAS: MoodPreviewWork[] = [
  {
    id: "a", title: "The Villainess Is Retiring", decisionScore: 8.4,
    scores: { romance: 7.5, drama: 4, tragedy: 2, adult_content: 5, humor: 8 },
    totalChapters: 80, personalFit: 0.9, totalVotes: 7100, synopsisQuality: "♥♥♥",
    artPercentile: 0.30, publicationStatusId: ID("Hiatus"), platformAvg: 8.11, year: 2021,
  },
  {
    id: "b", title: "The Siren: Becoming the Villain's Family", decisionScore: 8.4,
    scores: { romance: 8, drama: 8, tragedy: 6, adult_content: 3, humor: 4 },
    totalChapters: 174, personalFit: 0.88, totalVotes: 7500, synopsisQuality: "♥♥♥",
    artPercentile: 0.62, publicationStatusId: ID("Hiatus"), platformAvg: 8.07, year: 2021,
  },
  {
    id: "c", title: "Darling, Why Can't We Divorce?", decisionScore: 8.4,
    scores: { romance: 7.5, drama: 6, tragedy: 3, adult_content: 5, humor: 6 },
    totalChapters: 97, personalFit: 0.85, totalVotes: 1800, synopsisQuality: "♥♥♥♥",
    artPercentile: 0.88, publicationStatusId: ID("Ongoing"), platformAvg: 8.01, year: 2024,
  },
  {
    id: "d", title: "A Marriage Alliance for Revenge", decisionScore: 8.3,
    scores: { romance: 6.5, drama: 8, tragedy: 6, adult_content: 2, humor: 2 },
    totalChapters: 97, personalFit: 0.85, totalVotes: 1200, synopsisQuality: "♥♥♥♥",
    artPercentile: 0.41, publicationStatusId: ID("Ongoing"), platformAvg: 7.87, year: 2022,
  },
  {
    id: "e", title: "Behind Her Highness's Smile", decisionScore: 8.3,
    scores: { romance: 7.5, drama: 8.5, tragedy: 6.5, adult_content: 9, humor: 4.5 },
    totalChapters: 110, personalFit: 0.66, totalVotes: 3600, synopsisQuality: "♥♥♥",
    artPercentile: 0.71, publicationStatusId: ID("Completed"), platformAvg: 8.11, year: 2024,
  },
]

/** Um caso por TIPO de entrada — é a variedade que impede a coincidência. */
const MOODS: Array<[string, MoodRefine]> = [
  ["vazio", { attributes: {}, practical: {} }],
  ["par positivo (concluída)", { attributes: {}, practical: { publication: 1 } }],
  ["par negativo (de nicho)", { attributes: {}, practical: { popularity: -2 } }],
  ["par negativo (mais antiga)", { attributes: {}, practical: { recency: -1 } }],
  ["chip simples (arte)", { attributes: {}, practical: { art: 1 } }],
  ["chip em dobro (arte ++)", { attributes: {}, practical: { art: 2 } }],
  ["atributo positivo (adulto ++)", { attributes: { adult_content: 2 }, practical: {} }],
  ["atributo negativo (evitar tragédia)", { attributes: { tragedy: -2 }, practical: {} }],
  ["capítulos curtos", { attributes: {}, chapters: "curto", practical: {} }],
  [
    "combinação",
    {
      attributes: { adult_content: 2, humor: -1 },
      chapters: "longo",
      practical: { art: 2, publication: -1, popularity: 1 },
    },
  ],
]

const ordemNaTela = () =>
  screen.getAllByTestId("previa-obra").map((n) => n.textContent)

afterEach(cleanup)

/** Remove comentários de bloco e de linha — a regra é sobre o CÓDIGO. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

describe("a prévia mostra a MESMA ordem que a comparação vai abrir", () => {
  for (const [nome, mood] of MOODS) {
    it(`bate com sortByMoodAdjusted — ${nome}`, () => {
      render(<MoodPreview works={OBRAS} mood={mood} active={isMoodActive(mood)} />)
      const doDono = sortByMoodAdjusted(OBRAS, mood).map((w) => (w as MoodPreviewWork).title)
      expect(ordemNaTela()).toEqual(doDono)
    })
  }

  /**
   * Contraprova da própria bateria: se TODOS os moods produzissem a mesma ordem, o
   * teste acima passaria com qualquer implementação — inclusive uma que ignorasse o
   * mood. Exigir que os casos gerem ordens diferentes é o que dá poder a ele.
   */
  it("os moods escolhidos produzem ordens DIFERENTES — senão a bateria não separa nada", () => {
    const ordens = new Set(
      MOODS.map(([, mood]) => sortByMoodAdjusted(OBRAS, mood).map((w) => w.id).join(">")),
    )
    expect(ordens.size).toBeGreaterThanOrEqual(5)
  })

  it("sem mood, a ordem é a de entrada e não há setas de movimento", () => {
    render(<MoodPreview works={OBRAS} mood={{ attributes: {}, practical: {} }} active={false} />)
    expect(ordemNaTela()).toEqual(OBRAS.map((w) => w.title))
    expect(screen.queryByText(/↑|↓/)).toBeNull()
  })

  it("com mood, a seta diz quantas posições a obra andou", () => {
    // Pedir conteúdo adulto no máximo sobe a obra de adulto 9, que estava em último.
    render(
      <MoodPreview works={OBRAS} mood={{ attributes: { adult_content: 2 }, practical: {} }} active />,
    )
    expect(ordemNaTela()[0]).toBe("Behind Her Highness's Smile")
    expect(screen.getByText("↑4")).toBeTruthy()
  })
})

/**
 * 🔴 A regra que o teste de equivalência sozinho não pega: a prévia pode estar certa
 * HOJE com uma cópia da fórmula que amanhã diverge. Aritmética neste arquivo é o
 * sintoma, e ela não tem por que existir — o componente chama uma função e mapeia.
 */
describe("a prévia não tem cálculo próprio", () => {
  const SRC = readFileSync(resolve(process.cwd(), "components/ranking/mood-preview.tsx"), "utf8")
  const corpo = SRC.split("export function MoodPreview")[1] ?? ""

  it("chama o dono do cálculo", () => {
    expect(SRC).toContain("sortByMoodAdjusted")
    expect(SRC).toContain("@/lib/calculations/mood-refine")
  })

  it("não reimplementa a fórmula — sem MOOD_SWING nem constante de peso solta", () => {
    expect(corpo).not.toContain("MOOD_SWING")
    expect(corpo).not.toMatch(/0\.9\b/)
    // `computeMoodFit` é a peça interna do cálculo; usá-la aqui seria refazer o
    // caminho em vez de consumir o resultado.
    // ⚠️ Sem os COMENTÁRIOS: o docstring de `maxItems` explica por que cortar antes
    // de ordenar quebraria a normalização, e cita `computeMoodFit` por nome. Casar a
    // string no arquivo cru transformava a explicação da regra em violação dela —
    // mesma correção que `abas-da-obra.test.ts` já tinha precisado fazer.
    expect(semComentarios(corpo)).not.toContain("computeMoodFit")
  })

  it("não faz aritmética sobre as notas da obra", () => {
    const contas = corpo.match(/\bw\.(decisionScore|personalFit|artPercentile|platformAvg|totalVotes|scores)\s*[*/+-]/g)
    expect(contas, "a prévia está calculando em vez de consumir a ordem pronta").toBeNull()
  })
})
