import { describe, it, expect } from "vitest"
import { readingLock } from "@/lib/onboarding/reading-lock"

/** A escala da tela de notas trava só em "Estou lendo" com o capítulo preenchido e abaixo de 20%. */
describe("trava da nota na tela de notas", () => {
  it("Terminei e Larguei nunca travam", () => {
    expect(readingLock("terminei", null, 247).locked).toBe(false)
    expect(readingLock("larguei", 3, 247).locked).toBe(false)
  })

  it("Estou lendo com o capítulo em branco libera", () => {
    expect(readingLock("lendo", null, 247)).toEqual({ locked: false, text: null })
  })

  it("Estou lendo abaixo de 20% trava e diz a partir de qual capítulo libera", () => {
    expect(readingLock("lendo", 30, 247)).toEqual({ locked: true, text: "Dá para dar nota a partir do cap. 50 (20%)." })
    // 20% exato não passa (o limiar é estrito): 49 de 245 é 20%.
    expect(readingLock("lendo", 49, 245).locked).toBe(true)
    expect(readingLock("lendo", 60, 247).locked).toBe(false)
  })

  it("sem o total, capítulo preenchido trava e o texto não inventa um número", () => {
    expect(readingLock("lendo", 300, null)).toEqual({
      locked: true,
      text: "Sem o total de capítulos da obra, a nota só vale com o capítulo em branco.",
    })
  })
})
