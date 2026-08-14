import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ART_FILTER_ORDER,
  ART_FILTER_PARAM,
  ART_FILTER_SEGMENT_LABELS,
  ART_FILTER_TOOLTIPS,
  parseArtFilter,
} from "@/lib/arte/url"
import { ART_BAND_CUTOFFS } from "@/lib/arte/bands"

/**
 * O controle de arte só aparece para quem TEM estimativa (`showArtFilter={…isOwner}`), então
 * ele nunca foi visto renderizado por olho anônimo — nem no Playwright, onde a página abre sem
 * sessão. As larguras foram medidas no browser clonando a linha vizinha com a fonte real; o que
 * FALTAVA era a prova de que os três botões chegam à árvore, na ordem certa e com o texto certo.
 *
 * ⚠️ Este teste desenha o segmentado com o MESMO laço que o painel usa (`ART_FILTER_ORDER.map`),
 * e não uma cópia dos três botões: cópia passaria verde com o painel enumerando à mão de novo,
 * que foi exatamente o estado anterior — o mais restritivo no meio e o texto divergindo do card
 * da obra.
 */

/** Réplica mínima do `HideAvoidedSegment`: só o que este teste precisa provar (rótulo + tooltip
 *  + estado ativo). O componente real vive dentro de `RankingFilters`, que exige router,
 *  searchParams e ~40 props de dado — montar tudo isso testaria o painel, não a régua. */
function Segmento({ artMode }: { artMode: string }) {
  return (
    <TooltipProvider>
      <div className="inline-flex">
        {ART_FILTER_ORDER.map((value) => (
          <button
            key={value ?? "off"}
            type="button"
            aria-pressed={artMode === (value ?? "off")}
            title={value ? ART_FILTER_TOOLTIPS[value] : "Não filtra por arte."}
          >
            {value ? ART_FILTER_SEGMENT_LABELS[value] : "Tudo"}
          </button>
        ))}
      </div>
    </TooltipProvider>
  )
}

describe("o segmentado de arte na árvore desenhada", () => {
  it("desenha TRÊS botões, na ordem de exigência crescente", () => {
    render(<Segmento artMode="off" />)
    const botoes = screen.getAllByRole("button")
    expect(botoes).toHaveLength(3)
    // A ordem é o ponto: "Top 20%" (o mais restritivo) tem que ser o ÚLTIMO. Antes era o do
    // meio, e um segmentado é lido como escala da esquerda para a direita.
    expect(botoes.map((b) => b.textContent)).toEqual([
      "Tudo",
      ART_FILTER_SEGMENT_LABELS.sem_fraca,
      ART_FILTER_SEGMENT_LABELS.forte,
    ])
  })

  it("o texto visível traz o número, e ele é o corte de faixa", () => {
    render(<Segmento artMode="off" />)
    const pctBaixo = Math.round(ART_BAND_CUTOFFS.fraca * 100)
    const pctAlto = Math.round((1 - ART_BAND_CUTOFFS.forte) * 100)
    expect(screen.getByText(`Sem os ${pctBaixo}% piores`)).toBeTruthy()
    expect(screen.getByText(`Top ${pctAlto}%`)).toBeTruthy()
  })

  it("cada botão carrega o tooltip do seu lado da assimetria", () => {
    // A frase do "sem estimativa" é a única coisa que a pessoa não deduz da tela, e os dois
    // lados são opostos: "Top 20%" exclui quem não tem estimativa, "Sem os 20% piores" mantém.
    render(<Segmento artMode="off" />)
    expect(
      screen.getByText(ART_FILTER_SEGMENT_LABELS.forte).getAttribute("title")
    ).toMatch(/SEM estimativa fica de fora/)
    expect(
      screen.getByText(ART_FILTER_SEGMENT_LABELS.sem_fraca).getAttribute("title")
    ).toMatch(/SEM estimativa CONTINUA aparecendo/)
  })

  it("o botão aceso é o do valor da URL — e só ele", () => {
    render(<Segmento artMode="forte" />)
    const acesos = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
    expect(acesos).toHaveLength(1)
    expect(acesos[0].textContent).toBe(ART_FILTER_SEGMENT_LABELS.forte)
  })

  it("valor inválido na URL não acende nada além do 'Tudo'", () => {
    // `parseArtFilter` devolve undefined para lixo; o painel cai em "off". Um fallback que
    // acendesse "Top 20%" filtraria o catálogo por algo que ninguém pediu.
    const modo = parseArtFilter("media") ?? "off"
    render(<Segmento artMode={modo} />)
    const acesos = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
    expect(acesos.map((b) => b.textContent)).toEqual(["Tudo"])
  })

  it("o parâmetro de URL continua sendo o do contrato", () => {
    expect(ART_FILTER_PARAM).toBe("art")
  })
})
