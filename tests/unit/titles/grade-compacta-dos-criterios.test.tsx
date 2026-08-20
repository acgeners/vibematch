import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CriteriaGrid } from "@/components/titles/criteria-grid"
import type { CriterioItem } from "@/components/titles/criteria-grid"
import { CRITERION_SLUGS } from "@/types/domain"
import { RUBRIC_BANDS, bandForScore } from "@/lib/criteria/justification"

/**
 * A grade compacta abre UMA justificativa por vez — e é isso que trava a altura do bloco.
 *
 * 🔴 Antes eram 9 cards com a prosa toda aberta, e a altura era refém do quanto o modelo
 * escreveu: medido no app em 2026-08-19, **1.687px no desktop (63% da aba) e 4.244px no
 * iPhone SE (70%, 6,4 telas de rolagem)**. Depois: 685px e 1.248px.
 *
 * ⚠️ **A ALTURA não é testável aqui** — jsdom não tem layout, e casar a string `@2xl` protegeria
 * a grafia, o que esta base proíbe. Os números acima foram medidos no browser e estão no
 * CLAUDE.md. O que este arquivo guarda é o COMPORTAMENTO, que é o que regride: se duas
 * justificativas puderem ficar abertas ao mesmo tempo, o bloco volta a crescer com o texto e
 * nada acusa — a tela continua plausível, só mais longa.
 */

const item = (slug: string, nome: string, nota: number): CriterioItem => ({
  slug,
  nome,
  notaTexto: nota.toFixed(1),
  faixaIndex: RUBRIC_BANDS.indexOf(bandForScore(nota) as (typeof RUBRIC_BANDS)[number]),
  faixaLabel: bandForScore(nota),
  pillClass: "",
})

const CENARIO = [item("romance", "Romance", 7.5), item("humor", "Humor", 2.0), item("drama", "Drama", 9.5)]
const detalhes = CENARIO.map((c) => <p key={c.slug}>justificativa de {c.nome}</p>)

const montar = (items = CENARIO) => render(<CriteriaGrid items={items} detalhes={detalhes} />)
/** Quantas justificativas estão na árvore. O painel largo e o acordeão coexistem por CSS,
 *  então contar ocorrências é o jeito de ver "quantos critérios estão abertos". */
const abertos = () =>
  CENARIO.filter((c) => screen.queryAllByText(`justificativa de ${c.nome}`).length > 0).map((c) => c.slug)

describe("grade compacta dos 9 critérios", () => {
  it("desenha uma linha por critério recebido, com nome e nota", () => {
    montar()
    for (const c of CENARIO) {
      expect(screen.getByText(c.nome)).toBeTruthy()
      expect(screen.getAllByText(c.notaTexto!).length).toBeGreaterThan(0)
    }
  })

  it("o PRIMEIRO critério já abre — painel vazio no load não ensina a interação", () => {
    montar()
    expect(abertos()).toEqual(["romance"])
  })

  it("🔴 abre UMA justificativa por vez — é o que trava a altura do bloco", () => {
    montar()
    fireEvent.click(screen.getByText("Humor"))
    expect(abertos()).toEqual(["humor"])
    fireEvent.click(screen.getByText("Drama"))
    // Se o clique ACUMULASSE, aqui viriam dois — e o bloco voltaria a crescer com o texto.
    expect(abertos()).toEqual(["drama"])
  })

  it("clicar no critério já aberto FECHA, e o painel diz o que fazer", () => {
    montar()
    fireEvent.click(screen.getByText("Humor"))
    expect(abertos()).toEqual(["humor"])
    fireEvent.click(screen.getByText("Humor"))
    expect(abertos()).toEqual([])
    expect(screen.getByText(/Escolha um critério/i)).toBeTruthy()
  })

  it("o estado ARIA acompanha o que está aberto", () => {
    montar()
    const linha = screen.getByText("Humor").closest("button")!
    expect(linha.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(linha)
    expect(linha.getAttribute("aria-expanded")).toBe("true")
  })

  it("critério SEM nota desenha o traço, não um zero", () => {
    // Zero é uma nota real (Conteúdo Adulto 0,0 existe); imprimir "0" para ausência afirmaria
    // uma medição que ninguém fez.
    montar([{ slug: "x", nome: "Sem nota", notaTexto: null, faixaIndex: -1, faixaLabel: null, pillClass: "" }])
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("🔴 a ordem das faixas DERIVA da rubrica, não de uma lista escrita à mão", () => {
    // Faixa nova (ou renomeada) na rubrica precisa chegar aqui sozinha. Se alguém fixar
    // ["0-3","4-6","7-8","9-10"] no componente, isto continua verde — por isso o que se checa
    // é o índice bater com `bandForScore` em toda a escala, inclusive nas BORDAS, onde o bin
    // semiaberto de `bandBarBounds` já enganou uma régua antes.
    for (const nota of [0, 3, 3.5, 4, 6, 6.5, 7, 8, 8.5, 9, 10]) {
      const i = RUBRIC_BANDS.indexOf(bandForScore(nota) as (typeof RUBRIC_BANDS)[number])
      expect(i, `nota ${nota} caiu fora da rubrica`).toBeGreaterThanOrEqual(0)
    }
    expect(RUBRIC_BANDS.length).toBe(4)
  })

  it("a página tem os 9 critérios para entregar (contraprova de vacuidade)", () => {
    expect(CRITERION_SLUGS.length).toBe(9)
  })
})
