import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

  /**
   * 🔴 O corpo do badge não pode LER O RELÓGIO — ele decide a FORMA da árvore (`<Badge>` sozinho
   * × `Tooltip > Trigger > span > Badge`), e ~20 telas o renderizam. Render impuro ali é o
   * caminho para o "Hydration failed", que não quebra teste nem build: o React só descarta a
   * subárvore em silêncio.
   *
   * ⚠️ Teste de SOURCE de propósito. Um teste de render passaria verde com o `new Date()` no
   * lugar — o texto mora dentro do `TooltipContent`, que fica desmontado enquanto fechado, então
   * a impureza não aparece na árvore desenhada. É a versão anterior deste arquivo que ele
   * reprova.
   */
  /**
   * 🔴 O badge monta um `Tooltip` do Radix, e por isso o arquivo TEM que ser client component.
   *
   * Medido no app rodando (2026-08-12): compartilhado, os consumidores SERVER (`/` e `/login`)
   * emitiam a árvore do Radix só no payload RSC e ZERO no HTML do SSR (0 × 2 e 0 × 12) — o
   * cliente montava na hidratação um `<span>` gatilho que o servidor não tinha, os irmãos
   * deslizavam e o React reprovava a subárvore inteira ("Hydration failed"). Com a diretiva:
   * HTML 2 e 12, payload 0.
   *
   * ⚠️ Nada mais acusa isso: `tsc`, `eslint`, `next build` e os testes de render passam verdes
   * nos dois casos — a divergência só existe entre o HTML do SSR e o payload, em runtime.
   */
  it("é client component — o tooltip precisa existir no HTML do SSR", () => {
    const src = readFileSync(resolve(process.cwd(), "components/ui/status-badge.tsx"), "utf8")
    expect(src.split("\n")[0].trim()).toBe('"use client"')
  })

  it("só o `HiatusSinceLine` lê o relógio — nunca o corpo do badge", () => {
    const src = readFileSync(resolve(process.cwd(), "components/ui/status-badge.tsx"), "utf8")
    // ⚠️ Sem tirar os comentários, o próprio aviso que explica a regra ("no corpo do badge, o
    // `new Date()` decidiria a FORMA…") reprova o arquivo consertado.
    const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const corpo = semComentarios(
      src.slice(
        src.indexOf("export function PublicationStatusBadge"),
        src.indexOf("interface PersonalStatusBadgeProps"),
      ),
    )
    expect(corpo).not.toBe("")
    expect(corpo).not.toMatch(/new Date\(/)

    // Contraprova: o relógio existe, e existe no único lugar que só monta com o tooltip aberto.
    const linha = semComentarios(
      src.slice(src.indexOf("function HiatusSinceLine"), src.indexOf("export function PublicationStatusBadge")),
    )
    expect(linha).toMatch(/new Date\(/)
  })
})
