import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))

import { TagStanceMark, tagStanceTitle } from "@/components/ui/tag-stance-mark"

/**
 * O marcador de ênfase 2× no chip da tag.
 *
 * De RENDER de propósito, e com uma varredura de ESCOPO junto. O que regride
 * nesta classe não é a lógica — essa está em `tests/unit/tags/enfase-forte.ts` —
 * é uma superfície esquecer de desenhar o marcador. Um teste de unidade sobre
 * `segmentTags` fica verde com as três telas pintando os dois níveis igual.
 */

afterEach(cleanup)

describe("TagStanceMark", () => {
  it("desenha FORMA, não cor — o nível não pode depender só do verde/vermelho", () => {
    // 🔴 Os dois níveis dividem a mesma cor de stance. Se o marcador virar "um
    // tom mais escuro", a distinção some pra quem enxerga cor com dificuldade —
    // e, medido no catálogo, 43% dos chips amados de uma obra são fortes.
    const { container } = render(<TagStanceMark stance="love" />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    // Coração PREENCHIDO: o contorno vazado é o que o Radix/lucide dá por padrão
    // e ele lê como ícone decorativo, não como marca de intensidade.
    expect(svg?.getAttribute("fill")).toBe("currentColor")
  })

  it("evitada forte tem glifo PRÓPRIO — não é o coração recolorido", () => {
    const love = render(<TagStanceMark stance="love" />).container.innerHTML
    cleanup()
    const avoid = render(<TagStanceMark stance="avoid" />).container.innerHTML
    expect(avoid).not.toBe(love)
  })
})

describe("tagStanceTitle", () => {
  it("distingue os dois níveis E a origem da stance", () => {
    expect(tagStanceTitle({ stance: "love", strong: true, source: "declared" })).toMatch(/Muito amada/)
    expect(tagStanceTitle({ stance: "love", strong: false, source: "declared" })).toMatch(/^Amada/)
    expect(tagStanceTitle({ stance: "avoid", strong: true, source: "declared" })).toMatch(/Muito evitada/)
    expect(tagStanceTitle({ stance: "avoid", strong: false, source: "declared" })).toMatch(/^Evitada/)
  })

  it("não afirma 'você marcou' sobre tag que veio do perfil inferido", () => {
    // A stance do perfil é inferência do modelo. Dizer que a pessoa a declarou é
    // uma mentira plausível — e ela manda a pessoa procurar em /preferences uma
    // linha que não existe.
    const tip = tagStanceTitle({ stance: "love", strong: false, source: "profile" })
    expect(tip).toMatch(/perfil de gosto/)
    expect(tip).not.toMatch(/você marcou/)
  })
})

describe("cobertura das superfícies", () => {
  // As três telas que pintam tags de obra com stance. Ler o ARQUIVO é o que pega
  // o modo de falha real: a lógica continua devolvendo `strong: true` e a tela
  // simplesmente não o desenha.
  const SURFACES = [
    "app/catalog/[id]/page.tsx", // card Tags da página da obra
    "components/titles/work-compare-drawer.tsx", // prévia e popover do comparador
    "components/ai-evaluation/synopsis-inputs-popover.tsx", // "Informações sobre a obra"
  ]

  it.each(SURFACES)("%s desenha o marcador e o tooltip do nível", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8")
    expect(src).toContain("<TagStanceMark")
    expect(src).toContain("tagStanceTitle")
  })
})
