import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { classifyPace } from "@/lib/reading/pace-bands"
import { hiatusSinceLabel } from "@/lib/works/hiatus-display"

/**
 * 🔴 Teste de RENDER de propósito, e não por preferência de estilo. Este badge passou a montar
 * um `Tooltip` do Radix, e este app **não tem `TooltipProvider` no layout raiz**: sem um
 * provider local o Radix LANÇA durante o render e derruba a árvore inteira que o contém — o
 * badge aparece em ~20 telas, então uma delas seria uma página branca. `npm run build` e o
 * `tsc` passam limpos nesse caso, porque é erro de runtime. Só montar o componente pega.
 */

const NOTA_ENTRE_TEMPORADAS =
  "111 Chapters (Hiatus) since 06.2026\n\nS1: 40 Chapters (01-40)\nS2: 35 Chapters (41-75)\nS3: 36 Chapters (76-111)\nS4: TBA"

describe("PublicationStatusBadge: o tipo de hiato aparece sem derrubar a página", () => {
  it("monta com tooltip (contraprova do TooltipProvider ausente)", () => {
    expect(() =>
      render(
        <PublicationStatusBadge
          status="Hiatus"
          hiatusKind="between_seasons"
          hiatusKindConfidence="high"
          publicationStatusNote={NOTA_ENTRE_TEMPORADAS}
        />,
      ),
    ).not.toThrow()
  })

  it("mostra o rótulo quando há largura", () => {
    render(<PublicationStatusBadge status="Hiatus" hiatusKind="between_seasons" hiatusKindConfidence="high" />)
    expect(screen.getByText("entre temporadas")).toBeTruthy()
    expect(screen.getByText("»")).toBeTruthy()
  })

  it("no modo compacto o texto sai mas o glifo FICA", () => {
    render(<PublicationStatusBadge status="Hiatus" compact hiatusKind="mid_season" hiatusKindConfidence="high" />)
    expect(screen.getByText("—")).toBeTruthy()
    // O glifo é `aria-hidden` (é forma, não conteúdo), então a palavra precisa sobreviver em
    // algum lugar — senão a distinção existe só para quem enxerga.
    expect(screen.getByText("interrompido")).toBeTruthy()
  })

  /**
   * 🔴 Este é o caso que a regra existe para NÃO afirmar. 5 obras decidem por sinal indireto;
   * pintar o glifo nelas daria a mesma ênfase de um `S4: TBA` explícito.
   */
  it("confiança BAIXA não ganha glifo nem rótulo no badge", () => {
    render(<PublicationStatusBadge status="Hiatus" hiatusKind="between_seasons" hiatusKindConfidence="low" />)
    expect(screen.queryByText("»")).toBeNull()
    expect(screen.queryByText("entre temporadas")).toBeNull()
  })

  it("obra sem tipo renderiza como antes", () => {
    render(<PublicationStatusBadge status="Hiatus" />)
    expect(screen.getByText("Hiatus")).toBeTruthy()
    expect(screen.queryByText("»")).toBeNull()
    expect(screen.queryByText("—")).toBeNull()
  })

  /**
   * ⚠️ O trigger `trg_clear_hiatus_kind` já garante isto no banco, mas a tela também renderiza
   * dado em voo — antes de gravar. Um tipo sobrevivente numa obra que voltou a publicar diria
   * "entre temporadas" com a obra saindo normalmente.
   */
  it("não qualifica o que NÃO é hiato, mesmo recebendo o tipo", () => {
    render(<PublicationStatusBadge status="Ongoing" hiatusKind="between_seasons" hiatusKindConfidence="high" />)
    expect(screen.queryByText("»")).toBeNull()
    expect(screen.queryByText("entre temporadas")).toBeNull()
  })
})

describe("classifyPace: as duas situações deixam de cair na mesma banda", () => {
  const base = { chaptersRead: 40, totalChapters: 40, pending: 0, lastReadAt: "2026-08-10" }

  it("separa entre-temporadas de interrompida", () => {
    expect(classifyPace({ ...base, publicationHiatus: true, hiatusKind: "between_seasons" })).toBe("season_break")
    expect(classifyPace({ ...base, publicationHiatus: true, hiatusKind: "mid_season" })).toBe("interrupted")
  })

  it("hiato sem tipo continua em `hiatus` — o comportamento de antes", () => {
    expect(classifyPace({ ...base, publicationHiatus: true, hiatusKind: null })).toBe("hiatus")
    expect(classifyPace({ ...base, publicationHiatus: true })).toBe("hiatus")
  })

  /**
   * O tipo sozinho não classifica: quem manda é o status da publicação. Sem isto, uma obra que
   * voltou a publicar mas ainda carregasse o tipo sairia da banda de ritmo dela.
   */
  it("o tipo é ignorado quando a publicação não está em hiato", () => {
    expect(classifyPace({ ...base, publicationHiatus: false, hiatusKind: "mid_season" })).toBe("uptodate")
  })
})

describe("PublicationStatusBadge: desde quando está parada", () => {
  const COM_DATA = "43 Chapters (Hiatus) Since 08/2022\n\nS1: 35 Chapters (01-35)\nS2: 08 Chapters (36-43)"
  const trigger = (c: HTMLElement) => c.querySelector("[data-slot='tooltip-trigger']")

  /**
   * ⚠️ O conteúdo do Radix só monta no hover, então o texto do tooltip é verificado em unit
   * (`hiatusSinceLabel`); aqui o que importa é se o badge chega a MONTAR o tooltip.
   */
  it("monta o tooltip quando há data", () => {
    const { container } = render(
      <PublicationStatusBadge status="Hiatus" hiatusKind="between_seasons" hiatusKindConfidence="low" publicationStatusNote={COM_DATA} />,
    )
    expect(trigger(container)).not.toBeNull()
  })

  /**
   * A data sozinha justifica o tooltip: nas obras cujo texto não decide o tipo, a idade é o
   * único sinal que sobra — e era justamente onde ela ficaria escondida.
   */
  it("monta o tooltip mesmo SEM tipo, quando há data", () => {
    const { container } = render(
      <PublicationStatusBadge status="Hiatus" publicationStatusNote="65 Chapters (Hiatus) Since 4/2025" />,
    )
    expect(trigger(container)).not.toBeNull()
  })

  it("obra sem data e sem tipo não ganha tooltip", () => {
    const { container } = render(<PublicationStatusBadge status="Hiatus" publicationStatusNote="27 Chapters (Hiatus)" />)
    expect(trigger(container)).toBeNull()
  })

  it("o rótulo diz a data e, a partir de um ano, a idade", () => {
    const agora = new Date("2026-08-12")
    expect(hiatusSinceLabel(COM_DATA, agora)).toBe("Parada desde agosto de 2022 · há 4 anos")
    expect(hiatusSinceLabel("65 Chapters (Hiatus) Since 4/2026", agora)).toBe("Parada desde abril de 2026")
    expect(hiatusSinceLabel("27 Chapters (Hiatus)", agora)).toBeNull()
  })

  it("singular no primeiro ano completo", () => {
    expect(hiatusSinceLabel("40 Chapters (Hiatus) since 06.2025", new Date("2026-08-12")))
      .toBe("Parada desde junho de 2025 · há 1 ano")
  })
})
