import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const acoes = vi.hoisted(() => ({
  savePilotTaste: vi.fn(async () => ({ ok: true })),
  saveQuickScore: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/server/actions/pilot-taste", () => ({ savePilotTaste: acoes.savePilotTaste }))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: acoes.saveQuickScore }))

const { PostTasteAssessment } = await import("@/components/pilot/post-taste-assessment")

const keys = [
  "like_female_lead_score",
  "like_male_lead_score",
  "like_couple_score",
  "like_setting_score",
  "like_tone_score",
  "like_art_score",
  "like_pacing_score",
  "like_ending_score",
] as const
const criteria = keys.map((key, i) => ({
  slug: `taste_${i}`,
  key,
  name: `Categoria ${i + 1}`,
  emoji: "•",
  description: "",
  hints: ["1", "2", "3", "4", "5"],
  allowsNa: key === "like_ending_score",
  isOverall: false,
}))
const vazio = Object.fromEntries(keys.map((k) => [k, null])) as Record<(typeof keys)[number], number | null>
const completo = { ...vazio, ...Object.fromEntries(keys.slice(0, 7).map((k) => [k, 10])) }

const card = (props: { score?: number | null; scores?: typeof vazio; legacyPresent?: boolean }) =>
  render(
    <PostTasteAssessment
      workId="w1"
      criteria={criteria}
      initialScores={props.scores ?? vazio}
      endingApplicable={false}
      score={props.score ?? null}
      legacyPresent={props.legacyPresent ?? false}
    />,
  )
const direta = (v: number) => screen.getByRole("group", { name: "Nota direta" }).querySelectorAll("button")[v - 1]

beforeEach(() => vi.clearAllMocks())

/** A página da obra ganha a nota direta, ao lado das categorias (mockup v3, 22/11/2026). */
describe("Como foi pra você?: nota direta e por categorias", () => {
  it("sem categorias completas, a nota direta vale: o selo diz 'Direta' e o toque grava", () => {
    card({ score: 7 })
    expect(direta(7).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Direta")).toBeTruthy()
    fireEvent.click(direta(8))
    expect(acoes.saveQuickScore).toHaveBeenCalledWith("w1", 8)
    expect(direta(8).getAttribute("aria-pressed")).toBe("true")
  })

  it("com as 7 categorias, vale a nota calculada e a direta fica desligada, com o caminho de volta", () => {
    card({ score: 7, scores: completo })
    expect(screen.getByText("Calculada")).toBeTruthy()
    expect(direta(7).getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText(/Vale a nota das categorias\. Para usar a nota direta, use “Remover minha nota”/)).toBeTruthy()
    fireEvent.click(direta(3))
    expect(acoes.saveQuickScore).not.toHaveBeenCalled()
  })

  it("com a avaliação antiga por critérios, ela vale e a direta fica desligada", () => {
    card({ score: 8.6, legacyPresent: true })
    expect(screen.getByText("Avaliação antiga")).toBeTruthy()
    expect(direta(9).getAttribute("aria-disabled")).toBe("true")
  })

  it("categorias pela metade são PRÉVIA, e dizem quantas faltam e que hoje vale a direta", () => {
    const tres = { ...vazio, like_female_lead_score: 8, like_male_lead_score: 8, like_couple_score: 8 }
    card({ score: 7, scores: tres })
    expect(screen.getByText(/faltam 4 de 7 para virar a sua nota \(hoje vale a direta, 7\)/)).toBeTruthy()
    expect(screen.getByText("Direta")).toBeTruthy()
  })
})
