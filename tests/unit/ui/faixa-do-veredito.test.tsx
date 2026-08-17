import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VERDICT_BAND_CUTOFFS, verdictBand, verdictBandClass } from "@/lib/ui/verdict-band"
import { confidenceMarkClass } from "@/lib/ai-evaluation/confidence-tone"
import { CONFIDENCE_CUTOFFS } from "@/lib/ai-evaluation/confidence-ruler"
import { AlignmentScoreCell } from "@/components/ranking/ranking-cells"

const raiz = process.cwd()
/** Sem comentários: eles CITAM o arranjo antigo ("`≥40` âmbar e `<40` cinza"), e a 1ª versão
 *  desta varredura reprovou acusando a própria explicação da mudança. */
const lerSemComentarios = (rel: string) =>
  readFileSync(join(raiz, rel), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/** As três telas que desenham um número 0–100 do consultor IA. */
const CONSUMIDORES = [
  "components/ranking/ranking-cells.tsx",
  "app/catalog/[id]/page.tsx",
]

afterEach(cleanup)

describe("as faixas seguem o SEMÁFORO, não a colorimetria", () => {
  it("os cortes separam as quatro faixas nas bordas", () => {
    expect(verdictBand(100)).toBe("forte")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.forte)).toBe("forte")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.forte - 0.1)).toBe("bom")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.bom)).toBe("bom")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.bom - 0.1)).toBe("morno")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.morno)).toBe("morno")
    expect(verdictBand(VERDICT_BAND_CUTOFFS.morno - 0.1)).toBe("fraco")
    expect(verdictBand(0)).toBe("fraco")
  })

  it("o âmbar é do FUNDO da rampa e o cinza é do meio — não o contrário", () => {
    // Escolha da Ana em 17/08/2026: amarelo já significa "pior que o neutro" em sinalização,
    // então ele avisa no fundo e o cinza descreve o morno. Este caso é a contraprova do
    // arranjo anterior (`≥40` âmbar, `<40` cinza), que passaria verde num teste que só
    // checasse "as quatro cores são distintas".
    expect(verdictBandClass(35)).toMatch(/amber/)
    expect(verdictBandClass(35)).not.toMatch(/slate/)
    expect(verdictBandClass(55)).toMatch(/slate/)
    expect(verdictBandClass(55)).not.toMatch(/amber/)
  })

  it("as quatro faixas têm cores distintas", () => {
    const tons = [88, 66, 55, 35].map(verdictBandClass)
    expect(new Set(tons).size).toBe(4)
  })

  it("não carrega `border-<cor>`, que neste app não pinta", () => {
    // `* { border-color }` no globals.css está FORA de layer e vence `@layer utilities`.
    // As três telas carregaram `border-<cor>-500/40` por meses sem nunca pintar; herdar as
    // classes mortas no dono novo é enterrar o defeito num lugar mais difícil de achar.
    for (const s of [88, 66, 55, 35]) {
      expect(verdictBandClass(s)).not.toMatch(/\bborder-/)
    }
  })
})

describe("nenhuma tela remonta a rampa por conta própria", () => {
  it("os consumidores importam o dono", () => {
    for (const arquivo of CONSUMIDORES) {
      expect(lerSemComentarios(arquivo), arquivo).toMatch(/verdictBandClass/)
    }
  })

  it("ninguém escolhe cor de fundo a partir do corte 80", () => {
    // O corte `80` é a identidade DESTA rampa (as outras do app usam 8, 75, 30…), então
    // achar um `>= 80` decidindo um `bg-` é achar uma segunda rampa do Veredito — que é o
    // fato, e não a grafia de uma cor.
    for (const arquivo of CONSUMIDORES) {
      const src = lerSemComentarios(arquivo)
      const rampas = [...src.matchAll(/>=\s*80\b/g)].filter((m) =>
        src.slice(m.index, m.index + 200).includes("bg-"),
      )
      expect(rampas.map((m) => src.slice(m.index, m.index + 60)), arquivo).toEqual([])
    }
  })
})

describe("o traço de confiança sai do dono dos cortes", () => {
  it("muda exatamente nos cortes de CONFIDENCE_CUTOFFS", () => {
    // Derivado, nunca 0,75/0,5 escritos de novo: mover o corte no dono tem que mover o traço.
    expect(confidenceMarkClass(CONFIDENCE_CUTOFFS.alta)).toBe(confidenceMarkClass(1))
    expect(confidenceMarkClass(CONFIDENCE_CUTOFFS.alta - 0.01)).toBe(
      confidenceMarkClass(CONFIDENCE_CUTOFFS.media),
    )
    expect(confidenceMarkClass(CONFIDENCE_CUTOFFS.media - 0.01)).toBe(confidenceMarkClass(0))
  })

  it("confiança baixa é rose — a cor das outras quatro telas, não o slate desta", () => {
    expect(confidenceMarkClass(0.3)).toMatch(/rose/)
    expect(confidenceMarkClass(0.3)).not.toMatch(/slate/)
  })

  it("a célula não reescreve os cortes", () => {
    const src = lerSemComentarios("components/ranking/ranking-cells.tsx")
    expect(src).toMatch(/confidenceMarkClass/)
    expect(src).not.toMatch(/confidence\s*>=\s*0?\.\d/)
  })
})

describe("o marcador é um traço, e o slot dele é sempre reservado", () => {
  /** A pílula é o filho do gatilho do tooltip; o conteúdo do Radix não abre no jsdom. */
  const marcaDe = (confidence: number | null) => {
    const { container } = render(
      <AlignmentScoreCell
        score={66}
        justification={null}
        payload={confidence == null ? {} : { confidence }}
      />,
    )
    const marks = [...container.querySelectorAll("span")].filter((el) =>
      /\bw-\[15px\]/.test(el.className),
    )
    return marks
  }

  it("confiança alta e média pintam o traço de cores diferentes", () => {
    const alta = marcaDe(0.85)[0]
    cleanup()
    const media = marcaDe(0.6)[0]
    expect(alta).toBeTruthy()
    expect(media).toBeTruthy()
    expect(alta!.className).not.toBe(media!.className)
  })

  it("sem confiança sobra uma trilha neutra, que não é nenhuma das três cores", () => {
    // 43% das obras com Veredito não têm confiança registrada (medido no app em 17/08/2026),
    // então este é o caso COMUM: sem o slot o número muda de altura entre linhas, e com o slot
    // vazio ele fica desalinhado dentro da pílula. A trilha não pode virar uma 4ª faixa.
    const [mark] = marcaDe(null)
    expect(mark).toBeTruthy()
    expect(mark!.className).toMatch(/\bbg-/)
    for (const cor of [/emerald/, /amber/, /rose/]) {
      expect(mark!.className).not.toMatch(cor)
    }
  })
})
