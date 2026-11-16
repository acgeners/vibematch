import { describe, it, expect } from "vitest"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { RUBRIC_BANDS, RUBRIC_TITLE_MAX_CHARS, rubricSummary, rubricTitle } from "@/lib/criteria/justification"

/**
 * 🔴 Em "Meu Status" o rótulo da faixa passava por cima do campo de nota. Desde a régua dos
 * 11 critérios, 7 deles escrevem a faixa como FRASE, e "tudo antes do primeiro ':'" virou a
 * frase inteira — até 289 caracteres — num chip que não encolhe.
 *
 * O universo sai de `CRITERION_SLUGS` × `RUBRIC_BANDS`: critério ou faixa nova entra na
 * checagem sozinho.
 */
describe("rótulo curto da faixa da rubrica", () => {
  const cases = CRITERION_SLUGS.flatMap((slug) =>
    RUBRIC_BANDS.filter((band) => (CRITERIA_RUBRICS[slug]?.ranges ?? []).some((r) => r.trim().startsWith(band))).map(
      (band) => [slug, band] as const,
    ),
  )

  it("cobre todos os critérios com rubrica", () => {
    expect(cases.length).toBeGreaterThanOrEqual(CRITERION_SLUGS.length * 4)
  })

  it.each(cases)("%s %s: o rótulo é curto ou não existe", (slug, band) => {
    const title = rubricTitle(slug, band)
    if (title != null) expect(title.length).toBeLessThanOrEqual(RUBRIC_TITLE_MAX_CHARS)
  })

  it.each(cases)("%s %s: sempre há uma explicação para o painel", (slug, band) => {
    expect(rubricSummary(slug, band)).toBeTruthy()
  })

  it("os rótulos de verdade continuam os mesmos", () => {
    expect(rubricTitle("couple_dynamics", "0-3")).toBe("Destrutiva")
    expect(rubricTitle("couple_dynamics", "4-6")).toBe("Conflituosa ou ambivalente")
    expect(rubricTitle("adult_content", "9-10")).toBe("Smut")
    expect(rubricTitle("protagonist", "4-6")).toBe("Protagonismo moderado")
  })

  it("faixa escrita como frase não vira rótulo — vira explicação", () => {
    expect(rubricTitle("romance", "7-8")).toBeNull()
    expect(rubricSummary("romance", "0-3")).toBe("Romance ausente ou marginal.")
  })
})
