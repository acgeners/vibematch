import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { R19_EDITION_TITLE, WorkContentChip } from "@/components/ui/work-content-chip"
import { TopWorkCard } from "@/components/dashboard/top-work-card"

/**
 * O selo de conteúdo vale no app INTEIRO (decisão de 2026-10-14): as listas e os cards usam a mesma
 * decisão do cabeçalho da obra (`workContentBadge`). Antes, cada superfície desenhava "18+" por
 * `is_adult`, e a mixed com `adult_override` (One Last Night) aparecia como "18+" — exclusivamente
 * adulta — tendo versão normal.
 */
afterEach(cleanup)

const chip = (isMixed: boolean, isAdult: boolean) => render(<WorkContentChip isMixed={isMixed} isAdult={isAdult} />).container

describe("WorkContentChip — o selo das listas e cards", () => {
  it("mixed ⇒ 'R19' com o texto completo no tooltip, nunca '18+'", () => {
    const c = chip(true, false)
    expect(c.textContent).toContain("R19")
    expect(c.textContent).not.toContain("18+")
    expect(c.querySelector(`[title="${R19_EDITION_TITLE}"]`)).not.toBeNull()
  })
  it("mixed com adult_override (gate ligado, o caso de One Last Night) ⇒ ainda 'R19', sem '18+'", () => {
    const c = chip(true, true)
    expect(c.textContent).toContain("R19")
    expect(c.textContent).not.toContain("18+")
  })
  it("adulta sem versão mais leve (r18_only, unknown, single adulta) ⇒ '18+' e nenhum selo de versão", () => {
    const c = chip(false, true)
    expect(c.textContent).toContain("18+")
    expect(c.textContent).not.toContain("R19")
  })
  it("obra comum ⇒ nenhum dos dois", () => {
    expect(chip(false, false).textContent).toBe("")
  })
})

describe("um card que decidia por is_adult (TopWorkCard) segue a mesma régua", () => {
  const card = (titulo: string, isMixed: boolean, isAdult: boolean) =>
    render(
      <TopWorkCard
        rank={1}
        scoreThresholds={null}
        work={{ id: "w", title: titulo, coverUrls: [], expectedScore: 7.4, publicationStatusId: null, personalStatusId: null, isAdult, isMixed }}
      />,
    ).container.textContent ?? ""
  it("mixed com adult_override (One Last Night) ⇒ 'R19', não '18+'", () => {
    const t = card("One Last Night With My Soon-To-Be Ex-husband", true, true)
    expect(t).toContain("R19")
    expect(t).not.toContain("18+")
  })
  it("r18_only ⇒ '18+'; obra comum ⇒ nenhum", () => {
    expect(card("A Lady's Risqué Hobby", false, true)).toContain("18+")
    const comum = card("3-Year Contract With the Grim Reaper", false, false)
    expect(comum).not.toContain("18+")
    expect(comum).not.toContain("R19")
  })
})

/**
 * A regressão que isto impede: uma superfície de OBRA voltar a desenhar a marca de 18+ decidindo
 * direto por `isAdult`/`is_adult` — o que pinta "18+" numa mixed com override (One Last Night).
 * O alvo é a COMBINAÇÃO condição-no-gate + marca de 18+ logo em seguida; `AdultBadge` estático
 * (legenda, exemplo) e `isAdult &&` que não desenha selo (desfoque, filtro) continuam permitidos.
 */
export function seloDecididoPeloGate(fonte: string): string[] {
  // Sem comentários: eles citam "18+" ao explicar a régua, e isso não desenha nada.
  const src = fonte.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  // Marca = o AdultBadge ou um elemento cujo TEXTO é "18+" / "🔞 18+" — não um rótulo como "Desmarcar 18+".
  const marca = /<AdultBadge|>\s*(?:🔞\s*)?18\+\s*</
  const achados: string[] = []
  // Só a condicional de JSX (`{x.isAdult && …}`, `{isAdult ? … }`), lida até o fim DA PRÓPRIA expressão —
  // uma janela fixa perdia a marca de className longo e pegava código vizinho.
  for (const m of src.matchAll(/\{\s*[\w.?!]*\b(isAdult|is_adult)\s*(&&|\?)/g)) {
    const resto = src.slice(m.index ?? 0, (m.index ?? 0) + 800)
    const fim = resto.search(/\)\s*\}|\/>\s*\}|:\s*null\s*\}/)
    const corpo = fim === -1 ? resto : resto.slice(0, fim + 1)
    if (marca.test(corpo)) achados.push(corpo.split("\n")[0].trim())
  }
  return achados
}

describe("nenhuma superfície de obra decide o selo por is_adult (lido do source)", () => {
  const arquivos = execSync("git ls-files app components", { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx$/.test(f))

  it("marca de 18+ sob condição direta em isAdult/is_adult não existe — a decisão é de workContentBadge", () => {
    const violacoes = arquivos.flatMap((f) => seloDecididoPeloGate(readFileSync(f, "utf8")).map((t) => `${f}: ${t}`))
    expect(violacoes).toEqual([])
  })

  it("a régua pega o que deve e deixa passar o que não é selo", () => {
    expect(seloDecididoPeloGate(`{work.isAdult && <AdultBadge className="x" />}`)).toHaveLength(1)
    expect(seloDecididoPeloGate(`{w.is_adult ? (\n  <span>18+</span>\n) : null}`)).toHaveLength(1)
    // className longo empurrava o "18+" para fora de uma janela fixa (o comparador escapava assim):
    expect(seloDecididoPeloGate(`{work.isAdult && (\n  <span\n    className="${"x ".repeat(120)}"\n  >\n    18+\n  </span>\n)}`)).toHaveLength(1)
    expect(seloDecididoPeloGate(`{isAdult && hideAdult && <BlurCover />}`)).toEqual([])
    expect(seloDecididoPeloGate(`<AdultBadge className="legenda" />`)).toEqual([])
    // os dois falsos positivos da 1ª versão desta régua, achados no repo:
    expect(seloDecididoPeloGate(`const gate = isAdult && hide\n  /** Quem oculta 18+ … */`)).toEqual([])
    expect(seloDecididoPeloGate(`{isAdult ? (\n  <Item>\n    Desmarcar 18+\n  </Item>\n) : null}`)).toEqual([])
  })
})
