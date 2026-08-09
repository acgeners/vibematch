import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

import { Header } from "@/components/layout/header"

/**
 * O cabeçalho de página é uma FAIXA, não um bloco de três linhas.
 *
 * Teste de RENDER de propósito. O que regride aqui não é uma fórmula — é a
 * relação entre elementos vizinhos, que `tsc` e varredura de source não veem:
 *
 * 1. **Kicker sem default.** Ele valia quando a sidebar de 13 itens era a única
 *    pista de "onde estou". Com a barra superior mostrando o destino aceso, um
 *    kicker herdado imprime a 3ª cópia da mesma palavra na dobra — e imprimia em
 *    5 `loading.tsx` que nunca pediram por ele.
 * 2. **Descrição curta é APOSTO do título** (mesma linha), longa desce. A régua é
 *    comprimento, não rota: `/ranking` tem 34 caracteres e `/leitura` tem 200.
 *    Um `<p>` mudo abaixo do título custa ~28px em toda página do app.
 * 3. **Descrição rica sempre desce.** `ReactNode` não tem `.length`; medir um
 *    `<span>` de chips como se fosse string acharia "curto" e tentaria encaixá-lo
 *    ao lado do título.
 */

const CURTA = "Obras ordenadas pela Nota Prevista" // 34 — a de /ranking
const LONGA =
  "Obras que você acompanha. Separadas entre publicação em andamento e concluídas/outras — verifique nas fontes externas se saíram capítulos novos." // a de /leitura

/** O `<div>` que o componente Header desenha (ancestral comum do h1 e da descrição). */
function blocoDo(h1: HTMLElement): HTMLElement {
  const bloco = h1.closest("div.relative")
  expect(bloco, "o Header perdeu o wrapper que carrega a régua de baixo").not.toBeNull()
  return bloco as HTMLElement
}

/** A linha de base do título: o flex que faz o wrap do aposto no celular. */
function linhaDoTitulo(h1: HTMLElement): HTMLElement {
  return h1.parentElement as HTMLElement
}

describe("Header — faixa única", () => {
  afterEach(cleanup)

  it("não imprime kicker quando ninguém pediu um", () => {
    render(<Header title="Ranking" description={CURTA} />)
    const bloco = blocoDo(screen.getByRole("heading", { level: 1 }))
    // O default era "Biblioteca". Qualquer texto em caixa alta aqui é kicker herdado.
    expect(bloco.textContent).not.toMatch(/Biblioteca/)
    expect(bloco.querySelectorAll("span.rounded-full")).toHaveLength(0)
  })

  it("descrição curta fica na MESMA linha do título, não abaixo", () => {
    render(<Header title="Ranking" description={CURTA} />)
    const h1 = screen.getByRole("heading", { level: 1 })
    const linha = linhaDoTitulo(h1)

    expect(linha.textContent).toContain(CURTA)
    // e não pode existir um parágrafo repetindo a mesma descrição embaixo
    expect(blocoDo(h1).querySelectorAll("p")).toHaveLength(0)
  })

  it("descrição longa desce pra linha de baixo, sem truncar", () => {
    render(<Header title="Acompanhamento" description={LONGA} />)
    const h1 = screen.getByRole("heading", { level: 1 })

    expect(linhaDoTitulo(h1).textContent).not.toContain(LONGA)
    const abaixo = blocoDo(h1).querySelector("p")
    expect(abaixo?.textContent).toBe(LONGA)
  })

  it("descrição que não é string sempre desce — ReactNode não tem comprimento", () => {
    render(<Header title="Recomendação" description={<span>12 obras · há 3 dias</span>} />)
    const h1 = screen.getByRole("heading", { level: 1 })

    expect(linhaDoTitulo(h1).textContent).toBe("Recomendação")
    expect(blocoDo(h1).querySelector("p")?.textContent).toBe("12 obras · há 3 dias")
  })

  it("kicker pedido vira chip na linha do título, não linha própria acima", () => {
    render(<Header kicker="Grupo" title="Shounen pesado" description={CURTA} />)
    const h1 = screen.getByRole("heading", { level: 1 })
    const linha = linhaDoTitulo(h1)

    const chip = linha.querySelector("span.rounded-full")
    expect(chip?.textContent).toBe("Grupo")
    // o chip precisa vir ANTES do título na ordem do documento
    expect(chip!.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("as ações ficam na mesma faixa do título", () => {
    render(
      <Header title="Ranking" description={CURTA} actions={<button type="button">✨ IA</button>} />
    )
    const h1 = screen.getByRole("heading", { level: 1 })
    const botao = screen.getByRole("button", { name: "✨ IA" })

    // irmãos dentro do mesmo wrapper flex — não empilhados em blocos diferentes
    expect(blocoDo(h1).contains(botao)).toBe(true)
    expect(botao.closest("div")?.parentElement).toBe(blocoDo(h1))
  })
})
