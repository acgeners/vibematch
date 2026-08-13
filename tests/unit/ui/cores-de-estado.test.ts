import { describe, it, expect } from "vitest"
import { STATUS_TONE } from "@/lib/ui/status-tone"
import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * A régua de cor de estado (`lib/ui/status-tone.ts`).
 *
 * O que este arquivo guarda não é a fórmula — é a EXCLUSIVIDADE. Antes da régua, o âmbar
 * dizia cinco coisas na mesma página da obra ("Desatualizado", "Previsão desatualizada",
 * "Inputs: média", avisos de conteúdo, "síntese corrompida", "tags: nunca rodou"), e o
 * modo de falha é sempre o mesmo: alguém precisa de um tom novo, escolhe "o amarelinho
 * que já existe" e nada quebra — a tela só para de distinguir o que pede ação do que
 * apenas descreve.
 *
 * ⚠️ Os tons são DERIVADOS do objeto, nunca listados à mão: um papel novo entra na
 * verificação sozinho. Uma lista fixa aqui só acharia o que alguém lembrou de escrever.
 */

/** Famílias do Tailwind que a régua usa — extraídas do próprio valor. */
function familias(classes: string): Set<string> {
  return new Set(
    [...classes.matchAll(/\b(?:text|bg|border|ring)-([a-z]+)-\d{2,3}/g)].map((m) => m[1]),
  )
}

const TONS = Object.keys(STATUS_TONE) as StatusTone[]

describe("régua de cor de estado", () => {
  it("cada tom fala UMA família de cor, do texto ao anel", () => {
    // Um tom que misturasse (texto âmbar, anel rose) seria dois estados num chip só.
    for (const tom of TONS) {
      const t = STATUS_TONE[tom]
      const cores = familias([t.text, t.chip, t.box, t.ring, t.outline].join(" "))
      expect(cores.size, `${tom}: ${[...cores].join(", ")}`).toBe(1)
    }
  })

  it("nenhuma família é usada por dois papéis", () => {
    // É a invariante inteira: cor repetida = significado ambíguo.
    const porFamilia = new Map<string, StatusTone[]>()
    for (const tom of TONS) {
      for (const cor of familias(STATUS_TONE[tom].chip)) {
        porFamilia.set(cor, [...(porFamilia.get(cor) ?? []), tom])
      }
    }
    const repetidas = [...porFamilia].filter(([, tons]) => tons.length > 1)
    expect(repetidas.map(([cor, tons]) => `${cor}: ${tons.join(" + ")}`)).toEqual([])
  })

  it("o âmbar é do DESATUALIZADO, e de mais ninguém", () => {
    // Decisão registrada em 12/08/2026: "desatualizado" aparece em quatro pontos da
    // página da obra (Veredito, Interesse, Estrutura de abertura, IA-Rk) e é o estado
    // mais acionável dela; os avisos de conteúdo foram pro vermelho do 🔞 18+.
    const donos = TONS.filter((tom) => familias(STATUS_TONE[tom].chip).has("amber"))
    expect(donos).toEqual(["stale"])
  })

  it("o violeta fica FORA da régua — proveniência de IA não é estado", () => {
    // O ✨ responde "quem escreveu isto", não "o que eu faço com isso". Deixar o violeta
    // entrar aqui autorizaria chip de estado em violeta, e a marca de IA perderia o dono.
    const todas = TONS.flatMap((tom) => [...familias(STATUS_TONE[tom].chip)])
    expect(todas).not.toContain("violet")
  })

  it("caixa e anel saem com `ring-*`, nunca `border-<cor>`", () => {
    // `* { border-color }` em globals.css (fora de @layer) vence utilities no Tailwind v4:
    // uma borda colorida sem `!` simplesmente não pinta, e o bug parece "a cor está fraca".
    for (const tom of TONS) {
      expect(STATUS_TONE[tom].box, tom).toMatch(/ring-/)
      expect(STATUS_TONE[tom].ring, tom).toMatch(/ring-/)
      expect(STATUS_TONE[tom].outline, tom).toMatch(/!/)
    }
  })

  it("todo tom tem os cinco formatos — quem falta vira literal solto no componente", () => {
    for (const tom of TONS) {
      for (const [campo, valor] of Object.entries(STATUS_TONE[tom])) {
        expect(valor.trim(), `${tom}.${campo}`).not.toBe("")
      }
    }
  })
})
