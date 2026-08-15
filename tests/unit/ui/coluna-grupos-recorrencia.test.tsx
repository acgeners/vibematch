import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GroupCountCell, GroupNamesList } from "@/components/titles/group-count-cell"
import { WORK_TABLE_COLUMNS, getDefaultWorkColumnConfig } from "@/components/titles/work-table-config"

/**
 * Teste de RENDER de propósito. O que regride aqui não é a contagem — é a CÉLULA: um teste
 * que lesse o mapa de grupos passaria verde com o número fora da tela, com os nomes só num
 * `title=` nativo, ou com a coluna nascendo visível numa tela que não tem o dado.
 *
 * As decisões medidas que ele trava (2026-08-15):
 *  - NÚMERO, nunca chip aceso: 36% das favoritas estão em 2+ grupos, e destaque em 1 de cada
 *    3 linhas é o alarme que ninguém lê;
 *  - os NOMES ficam no hover, porque a cor não identifica grupo (12 grupos, 4 cores — três
 *    deles dividem o mesmo rosa), então a bolinha só decora um rótulo já escrito.
 *
 * ⚠️ O conteúdo do tooltip é montado por `GroupNamesList` porque o Radix Tooltip **não abre
 * em jsdom** — conferido com uma sonda: nem `pointerMove` nem `focus` mexem no `data-state`.
 * A alternativa seria casar strings no source, e teste que casa grafia protege a grafia.
 */

const GRUPOS = [
  { id: "spicy", name: "Spicy", color: "348 78% 66%" },
  { id: "next", name: "Next", color: "42 88% 62%" },
]

const wrap = (ui: React.ReactNode) =>
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)

describe("célula de recorrência", () => {
  it("mostra o NÚMERO de grupos, e não os nomes, na linha", () => {
    const { container } = wrap(<GroupCountCell groups={GRUPOS} />)
    expect(screen.getByText("2")).toBeTruthy()
    // Nome de grupo na célula estouraria a coluna (76px) e repetiria em toda linha o que o
    // hover explica melhor.
    expect(container.textContent).not.toMatch(/Spicy|Next/)
  })

  it("oferece o gesto de hover quando há o que nomear", () => {
    const { container } = wrap(<GroupCountCell groups={GRUPOS} />)
    expect(container.querySelector("[data-slot='tooltip-trigger']")).toBeTruthy()
  })

  it("obra em nenhum grupo é um FATO, não um vazio: traço neutro e SEM hover", () => {
    const { container } = wrap(<GroupCountCell groups={[]} />)
    expect(screen.getByText("—")).toBeTruthy()
    // Hover que abre para dizer nada é pior que hover nenhum.
    expect(container.querySelector("[data-slot='tooltip-trigger']")).toBeNull()
  })
})

describe("os nomes que o hover revela", () => {
  it("lista todos os grupos, com o total no cabeçalho", () => {
    const { container } = wrap(<GroupNamesList groups={GRUPOS} />)
    expect(screen.getByText("Spicy")).toBeTruthy()
    expect(screen.getByText("Next")).toBeTruthy()
    expect(container.textContent).toMatch(/em 2 grupos/)
  })

  it("uma obra em um grupo só não vira “1 grupos”", () => {
    const { container } = wrap(<GroupNamesList groups={[GRUPOS[0]]} />)
    expect(container.textContent).toMatch(/em 1 grupo(?!s)/)
  })

  it("na página de um grupo, o grupo atual sai apagado — o que interessa é o resto", () => {
    wrap(<GroupNamesList groups={GRUPOS} currentGroupId="spicy" />)
    expect(screen.getByText("Spicy").className).toContain("text-background/50")
    expect(screen.getByText("Next").className).not.toContain("text-background/50")
  })

  it("o tom secundário é text-background, nunca token de página", () => {
    // Dentro do TooltipContent (que é invertido: bg-foreground + text-background),
    // `text-muted-foreground` cai para ~3:1 no tema claro — bug de 2026-07-03.
    const { container } = wrap(<GroupNamesList groups={GRUPOS} />)
    expect(container.innerHTML).not.toMatch(/text-muted-foreground|text-foreground\b/)
  })
})

describe("a coluna no seletor", () => {
  it("existe, é ocultável e tem descrição (o cabeçalho é só “Grupos”)", () => {
    const col = WORK_TABLE_COLUMNS.find((c) => c.key === "groups")
    expect(col).toBeDefined()
    expect(col!.locked).toBeFalsy()
    expect(col!.description).toBeTruthy()
  })

  it("nasce VISÍVEL em /favorites e OCULTA nas telas sem o dado", () => {
    // Só /favorites passa `groupsByWorkId`; nas outras a célula sairia "—" em toda linha.
    expect(getDefaultWorkColumnConfig("favorites").hidden).not.toContain("groups")
    for (const ns of ["titles", "ranking", "recommendations"] as const) {
      expect(getDefaultWorkColumnConfig(ns).hidden).toContain("groups")
    }
  })
})
