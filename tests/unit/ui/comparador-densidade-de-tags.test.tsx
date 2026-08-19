import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { TagDensityCell } from "@/components/titles/tag-density-cell"
import { describeWorkTags } from "@/lib/tags/density"
import type { TagStanceInfo } from "@/lib/tags/segment"

/**
 * Teste de RENDER de propósito: o que regride aqui não é a conta — é a CÉLULA.
 * `densidade-de-tags.test.ts` passaria verde com o percentual calculado e fora da
 * tela, com o absoluto num rodapé ambíguo, ou com a barra desenhando um segmento
 * sub-pixel indistinguível de "não tem nenhuma".
 *
 * Números do clone local (978 obras, 2026-08-18): mediana de 36 tags por obra
 * (p10 19 · p90 74 · máx 261), 41% amadas, 1,7% evitadas — e 44% das obras não
 * têm evitada nenhuma, que é o caso comum que a célula não pode poluir.
 */

const love: TagStanceInfo = { stance: "love", strong: false, source: "declared" }
const avoid: TagStanceInfo = { stance: "avoid", strong: false, source: "declared" }

const obra = (total: number, loved: number, avoided: number) =>
  describeWorkTags(
    [],
    [
      ...Array.from({ length: loved }, (_, i) => ({ name: `l${i}`, stance: love })),
      ...Array.from({ length: avoided }, (_, i) => ({ name: `a${i}`, stance: avoid })),
      ...Array.from({ length: total - loved - avoided }, (_, i) => ({ name: `r${i}`, stance: null })),
    ],
    (t) => t.stance,
  ).density

const larguras = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>("[style*='width']")).map((n) => n.style.width)

describe("a célula imprime a fatia", () => {
  it("mostra o % com o absoluto GRUDADO nele, e o denominador embaixo", () => {
    // Elissa's Whirlwind Marriage: 65 amadas (o recorde do catálogo) em 261 tags.
    const { container } = render(<TagDensityCell density={obra(261, 65, 2)} />)
    const texto = container.textContent ?? ""
    expect(texto).toContain("25%")
    expect(texto).toContain("(65)")
    expect(texto).toContain("de 261 tags")
    // Sem o denominador na tela, 25% e 56% comparam-se como se as obras tivessem
    // o mesmo tamanho — que é o defeito que esta linha existe pra desfazer.
  })

  it("desenha a barra proporcional ao %, não à contagem", () => {
    const { container } = render(<TagDensityCell density={obra(80, 45, 1)} />)
    expect(larguras(container.firstChild as HTMLElement)).toContain("56.25%")
  })

  it("uma tag evitada em 261 não vira fiapo sub-pixel", () => {
    // 1/261 = 0,38% da largura. Sem piso, "tem evitada" e "não tem" ficam iguais
    // na tela — e o texto ao lado diz "<1%", nunca "0%".
    const { container } = render(<TagDensityCell density={obra(261, 65, 1)} />)
    const rosa = container.querySelector<HTMLElement>(".bg-rose-500")
    expect(rosa).toBeTruthy()
    expect(rosa!.style.minWidth).toBe("3px")
    expect(container.textContent).toContain("<1%")
  })
})

describe("os casos que a distribuição real obriga a tratar", () => {
  it("sem nenhuma evitada, não sobra chip nem segmento — 44% das obras são assim", () => {
    const { container } = render(<TagDensityCell density={obra(37, 14, 0)} />)
    expect(container.querySelector(".bg-rose-500")).toBeNull()
    // Um "0%" rosa em quase metade das colunas é o alarme que ninguém lê.
    expect(container.textContent).not.toContain("0%")
    expect(container.textContent).toContain("38%")
  })

  it("zero amadas é cinza, nunca verde", () => {
    // Tomorrow's Thief: 33 tags, 0 amadas, 4 evitadas. Em verde, "0%" lê como um
    // valor bom apagado — a cor tem que dizer o que o número diz.
    const { container } = render(<TagDensityCell density={obra(33, 0, 4)} />)
    const zero = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === "0%")
    expect(zero, "o 0% precisa estar na tela").toBeTruthy()
    expect(zero!.className).toContain("text-muted-foreground")
    expect(zero!.className).not.toContain("emerald")
    expect(container.querySelector(".bg-emerald-500")).toBeNull()
  })

  it("obra sem tag nenhuma não afirma 0% — mostra o traço", () => {
    const { container } = render(<TagDensityCell density={obra(0, 0, 0)} />)
    expect(container.textContent).toBe("—")
  })
})
