import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import {
  AlignmentTooltipContent,
  SPARSE_TAGS_AT,
  LOW_ALIGNMENT_AT,
} from "@/components/ranking/score-tooltip-content"

/**
 * O tooltip do Alinhamento — teste de RENDER de propósito, por dois motivos.
 *
 * 1. O que regrediu aqui foi TEXTO, não fórmula: por ~2 meses o tooltip explicou
 *    `computePersonalFit` (40% tag + 30% critério + 30% consistência), morta desde
 *    2026-06-27 e REMOVIDA em 15/08/2026. Enquanto ela existiu, um teste que a
 *    exercitasse passaria verde com a mentira inteira na tela — a função compilava e
 *    funcionava; ela só não era o que calcula o número exibido (quem calcula é
 *    `netNameOverlap`, em `server/actions/calculations.ts` bloco 5).
 * 2. A ressalva de matéria-prima é CONDICIONAL, e a condição só existe na árvore
 *    desenhada.
 *
 * ⚠️ Os limiares saem das constantes exportadas, nunca reescritos aqui: uma 2ª cópia
 * é como o tooltip ressalva uma obra que a régua não considera sub-tagueada.
 */

afterEach(cleanup)

/** Um valor cru qualquer — o display prefere o percentil quando ele existe. */
const CRU = 0.31

describe("tooltip do Alinhamento: matéria-prima", () => {
  it("descreve a fórmula que RODA, não a aposentada", () => {
    const { container } = render(<AlignmentTooltipContent value={CRU} percentile={91} />)
    const texto = container.textContent ?? ""

    // O mecanismo real: soma das amadas − 1,5× as evitadas.
    expect(texto).toMatch(/amadas/i)
    expect(texto).toMatch(/1,5/)

    // Contraprova — os pesos da `computePersonalFit` removida não podem voltar ao texto.
    expect(texto).not.toMatch(/40%/)
    expect(texto).not.toMatch(/30%/)
    expect(texto).not.toMatch(/consistência/i)
    // E critério NÃO entra no Alinhamento (virou feature do Ridge da Nota Prevista).
    expect(texto).not.toMatch(/faixas ideais/i)
  })

  /**
   * A linha de números (Bruto · Percentil · N tags). Recortada pelo "Bruto" porque a
   * palavra "tags" também aparece na frase que explica a fórmula ("tags amadas") — casar
   * o documento inteiro confundiria as duas.
   */
  function linhaDeNumeros(container: HTMLElement): string {
    const p = Array.from(container.querySelectorAll("p")).find((el) =>
      (el.textContent ?? "").includes("Bruto"),
    )
    expect(p).toBeTruthy()
    return p!.textContent ?? ""
  }

  it("mostra o nº de tags quando ele viaja no payload", () => {
    const { container } = render(
      <AlignmentTooltipContent value={CRU} percentile={91} tagCount={14} />,
    )
    expect(linhaDeNumeros(container)).toMatch(/14\s*tags/)
  })

  it("sem tagCount não inventa número — é o caso do /ranking", () => {
    // `server/queries/ranking.ts` devolve `tags: []` de propósito (corte de egress),
    // então a prop chega ausente e a linha some em vez de imprimir "0 tags".
    const { container } = render(<AlignmentTooltipContent value={CRU} percentile={91} />)
    expect(linhaDeNumeros(container)).not.toMatch(/tag/i)
  })

  it("ressalva o valor BAIXO em obra sub-tagueada", () => {
    render(
      <AlignmentTooltipContent
        value={CRU}
        percentile={LOW_ALIGNMENT_AT - 1}
        tagCount={SPARSE_TAGS_AT - 1}
      />,
    )
    const aviso = screen.getByText(/tag faltando, não desalinhamento/i)
    expect(aviso).toBeTruthy()
    // A ênfase é CONTRASTE (sem alfa) contra o /70 das linhas de cima — nunca cor de
    // estado: âmbar é do "desatualizado" (régua do STATUS_TONE) e confiança de input já
    // foi decidida como não-cor. Ver os dois motivos no componente.
    expect(aviso.className).toContain("text-background")
    expect(aviso.className).not.toMatch(/amber|rose|emerald|sky/)
  })

  it("nenhuma linha usa token de PÁGINA na superfície invertida do tooltip", () => {
    // `TooltipContent` é `bg-foreground` + `text-background`. `text-muted-foreground` aqui
    // passa no escuro e cai pra ~3:1 no CLARO — é o bug de 03/07/2026, mesma família.
    const { container } = render(
      <AlignmentTooltipContent
        value={CRU}
        percentile={LOW_ALIGNMENT_AT - 1}
        tagCount={SPARSE_TAGS_AT - 1}
      />,
    )
    for (const el of Array.from(container.querySelectorAll("p, span"))) {
      expect(el.className).not.toMatch(/text-muted-foreground|text-foreground\b/)
    }
  })

  it("NÃO ressalva valor alto com poucas tags — medido: 3 obras em 988", () => {
    // `netName` é soma sem denominador, então poucas tags só empurram pra BAIXO.
    // Ressalvar um valor alto seria desmentir um número correto.
    const { container } = render(
      <AlignmentTooltipContent value={0.52} percentile={91} tagCount={SPARSE_TAGS_AT - 1} />,
    )
    expect(container.textContent).not.toMatch(/tag faltando/i)
  })

  it("NÃO ressalva valor baixo em obra BEM tagueada — aí é desalinhamento mesmo", () => {
    const { container } = render(
      <AlignmentTooltipContent
        value={CRU}
        percentile={LOW_ALIGNMENT_AT - 1}
        tagCount={SPARSE_TAGS_AT + 60}
      />,
    )
    expect(container.textContent).not.toMatch(/tag faltando/i)
  })

  it("sem percentil ainda explica a fórmula certa, sem prometer Top X%", () => {
    const { container } = render(<AlignmentTooltipContent value={CRU} tagCount={40} />)
    const texto = container.textContent ?? ""
    expect(texto).toMatch(/amadas/i)
    expect(texto).not.toMatch(/40%/)
    expect(texto).not.toMatch(/Top \d/)
    expect(texto).toMatch(/Re-rode/)
  })

  it("sem percentil NÃO ressalva — o limiar é da escala do percentil", () => {
    // `LOW_ALIGNMENT_AT` corta na escala do percentil. Sem ele o display cai no cru×100,
    // cujo teto é ~0,55 (a razão de o percentil existir): o mesmo "30" corta perto da
    // MEDIANA numa escala e perto do fundo na outra. O nº de tags, que é fato bruto,
    // continua saindo.
    const { container } = render(
      <AlignmentTooltipContent value={0.08} tagCount={SPARSE_TAGS_AT - 1} />,
    )
    expect(container.textContent).not.toMatch(/tag faltando/i)
    expect(linhaDeNumeros(container)).toMatch(new RegExp(`${SPARSE_TAGS_AT - 1}\\s*tags`))
  })
})
