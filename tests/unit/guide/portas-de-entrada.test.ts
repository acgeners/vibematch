import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Todo dicionário tem que ser ALCANÇÁVEL de onde o número é lido.
 *
 * 🔴 Medido em 2026-08-19: `/guide/attributes` e `/guide/scores` custaram trabalho real (as
 * artes, a derivação de `CRITERIA_RUBRICS` e de `EXPECTED_BASELINE_FEATURES`) e tinham **zero**
 * links fora do próprio `/guide` e do índice do ⌘K. Conteúdo publicado e inalcançável é pior
 * que conteúdo ausente: ele envelhece sem ninguém ler, e quem mantém acha que está servindo
 * alguém. É a mesma família do `CoverImage` com o fallback prometido e desligado em 34 telas.
 *
 * A porta mora no CABEÇALHO do bloco que mostra os números — "Notas por critério" para os
 * atributos, "Notas calculadas" para os números. **Não** no chip de faixa (são 9 por obra, e o
 * chip já mostra a rubrica daquela faixa) e **nunca** dentro de um tooltip: o `TooltipContent`
 * do Radix fecha quando o mouse sai do gatilho, e o link fica inalcançável.
 *
 * ⚠️ O universo sai do FILESYSTEM (`app/guide/<x>/page.tsx`), não de uma lista: dicionário novo
 * nasce precisando de porta, ou reprova. Lista fixa não acha o que ninguém apontou.
 */

const ROOT = join(__dirname, "../../..")

/** Os dicionários que existem hoje — derivados do disco, não escritos aqui. */
const DICIONARIOS = readdirSync(join(ROOT, "app/guide"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, "app/guide", d.name, "page.tsx")))
  .map((d) => `/guide/${d.name}`)
  .sort()

/**
 * ⚠️ `git ls-files` e não o disco: é o ÍNDICE que vira o commit. Arquivo não rastreado
 * contaria como porta e sumiria no merge.
 */
const FONTES = execSync("git ls-files app components lib", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f))

/**
 * As portas NÃO podem ser o próprio `/guide` (é o índice; quem já chegou lá não precisa de
 * porta) nem o índice da busca (`search-index.ts` é catálogo de busca, e depende de a pessoa
 * já saber o que procurar — é justamente o que falta a quem está olhando um número).
 */
const NAO_CONTA = (f: string) => f.startsWith("app/guide/") || f.endsWith("server/queries/search-index.ts")

/** Os intervalos `<TooltipContent …>…</TooltipContent>` de um arquivo. */
function faixasDeTooltip(src: string): Array<[number, number]> {
  const faixas: Array<[number, number]> = []
  for (const m of src.matchAll(/<TooltipContent\b/g)) {
    const fim = src.indexOf("</TooltipContent>", m.index!)
    faixas.push([m.index!, fim === -1 ? src.length : fim])
  }
  return faixas
}

interface Porta { arquivo: string; linha: number; dentroDeTooltip: boolean }

function portasDe(rota: string): Porta[] {
  const out: Porta[] = []
  for (const f of FONTES) {
    if (NAO_CONTA(f)) continue
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    const src = readFileSync(p, "utf8")
    if (!src.includes(rota)) continue
    const faixas = faixasDeTooltip(src)
    // `href="/guide/x"` — a rota tem que ser o valor INTEIRO, senão `/guide/s` casaria
    // `/guide/scores` e uma porta inexistente passaria por existente.
    for (const m of src.matchAll(new RegExp(`href=(?:"${rota}"|\\{"${rota}"\\})`, "g"))) {
      out.push({
        arquivo: f,
        linha: src.slice(0, m.index!).split("\n").length,
        dentroDeTooltip: faixas.some(([a, b]) => m.index! > a && m.index! < b),
      })
    }
  }
  return out
}

describe("os dicionários são alcançáveis de onde o número é lido", () => {
  it("o universo sai do filesystem (senão o teste passa por vacuidade)", () => {
    expect(DICIONARIOS.length).toBeGreaterThanOrEqual(2)
    expect(DICIONARIOS).toContain("/guide/attributes")
    expect(DICIONARIOS).toContain("/guide/scores")
    expect(FONTES.length).toBeGreaterThan(100)
  })

  it.each(DICIONARIOS)("%s tem porta fora do /guide e da busca", (rota) => {
    const portas = portasDe(rota)
    expect(
      portas.map((p) => `${p.arquivo}:${p.linha}`),
      `Nenhuma tela leva a ${rota}. Ele só é alcançável por quem já está no /guide ou já sabe ` +
        `procurar no ⌘K — ou seja, por quem menos precisa. A porta mora no CABEÇALHO do bloco ` +
        `que mostra esses números, com <GlossaryLink>.`,
    ).not.toEqual([])
  })

  it.each(DICIONARIOS)("%s: nenhuma porta fica DENTRO de um tooltip", (rota) => {
    // O TooltipContent do Radix fecha quando o mouse sai do gatilho: o link existe no DOM e
    // não é clicável. Passa no tsc, passa num teste que só procure o href, e não funciona.
    const presas = portasDe(rota)
      .filter((p) => p.dentroDeTooltip)
      .map((p) => `${p.arquivo}:${p.linha}`)
    expect(presas, `Link dentro de <TooltipContent> é inalcançável — tire do tooltip.`).toEqual([])
  })

  /**
   * ⚠️ Ancorar no `<CardTitle>`, nunca no texto solto: "Notas por critério" aparece ANTES num
   * comentário do arquivo, e `indexOf` pegava a explicação em vez do cabeçalho — o teste
   * reprovava com a porta no lugar certo.
   */
  const cabecalho = (titulo: string): string => {
    const src = readFileSync(join(ROOT, "app/catalog/[id]/page.tsx"), "utf8")
    const i = src.indexOf(`>${titulo}</CardTitle>`)
    expect(i, `não achei o <CardTitle> de "${titulo}"`).toBeGreaterThan(-1)
    // A porta pode vir antes ou depois do título dentro do mesmo cabeçalho.
    return src.slice(Math.max(0, i - 600), i + 600)
  }

  it("a porta dos atributos está no cabeçalho de 'Notas por critério'", () => {
    expect(cabecalho("Notas por critério")).toContain("/guide/attributes")
  })

  /**
   * 🔴 A porta deste card fica no RODAPÉ, e é medição: o topo do "Notas calculadas" tem
   * **374px** e o bloco da Nota Prevista ocupa a direita — com o link no cabeçalho, o título
   * QUEBRA em duas linhas (medido no browser em 2026-08-19: 86x48 contra 136x24). No rodapé
   * ele tem a largura toda e fica logo abaixo dos números que explica. Por isso a asserção é
   * "dentro do CARD", não "no cabeçalho": exigir o cabeçalho aqui seria pedir a regressão.
   */
  it("a porta dos números está no card de 'Notas calculadas'", () => {
    const src = readFileSync(join(ROOT, "app/catalog/[id]/page.tsx"), "utf8")
    const i = src.indexOf(">Notas calculadas</CardTitle>")
    expect(i).toBeGreaterThan(-1)
    const card = src.slice(i, src.indexOf("</Card>", i))
    expect(card).toContain("/guide/scores")
  })
})
