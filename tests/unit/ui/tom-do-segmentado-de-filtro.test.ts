import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FILTER_SEGMENT_BASE,
  filterSegmentClass,
  filterSegmentRole,
} from "@/lib/ui/filter-segment-tone"

const raiz = process.cwd()
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf-8")

/**
 * O card "Conteúdo exibido" acendia TRÊS pílulas com NENHUM filtro ligado: "Não" (não esconde
 * nada) e "Tudo" (não filtra arte) ficavam rosa, a cor que o resto do app usa para negativo,
 * excluído e falhou. Não era decisão de cor — eram dois componentes com duas convenções, e o
 * filtro de arte herdou a do controle de tags evitadas ao reusar o componente.
 */

describe("o papel sai do VALOR que o botão grava na URL", () => {
  it("null (limpa o parâmetro) é 'selected' — a opção que não corta nada", () => {
    expect(filterSegmentRole(null)).toBe("selected")
    expect(filterSegmentRole(undefined)).toBe("selected")
  })

  it("qualquer valor de filtro é 'cutting'", () => {
    for (const v of ["strong", "all", "forte", "sem_fraca"]) {
      expect(filterSegmentRole(v)).toBe("cutting")
    }
  })

  it("string vazia NÃO é 'selected'", () => {
    // `""` não é o mesmo que ausente: quem limpa o parâmetro neste painel é `null`. Tratar as
    // duas como iguais devolveria o azul a um botão que filtra.
    expect(filterSegmentRole("")).toBe("cutting")
  })
})

describe("os três papéis têm cores distintas", () => {
  it("selected, cutting e adult não colidem", () => {
    // Se dois papéis caírem na mesma cor, a distinção deixa de existir na tela sem nada acusar
    // — o `tsc` e o resto da suíte seguem verdes.
    const tons = (["selected", "cutting", "adult"] as const).map((r) => filterSegmentClass(true, r))
    expect(new Set(tons).size).toBe(3)
  })

  it("inativo não tem fundo, e é igual para os três papéis", () => {
    // O segmentado já mora dentro de uma caixa com borda; fundo no inativo apagaria a diferença
    // entre escolhido e não escolhido.
    const inativos = (["selected", "cutting", "adult"] as const).map((r) => filterSegmentClass(false, r))
    expect(new Set(inativos).size).toBe(1)
    expect(inativos[0]).not.toMatch(/\bbg-/)
  })

  it("todo botão carrega a base compartilhada", () => {
    for (const ativo of [true, false]) {
      expect(filterSegmentClass(ativo, "selected")).toContain(FILTER_SEGMENT_BASE)
    }
  })
})

describe("o defeito que originou o dono único", () => {
  it("a opção neutra NUNCA cai no tom de 'cortando'", () => {
    // Era exatamente isto na tela: "Não" e "Tudo" acesos em rosa, com zero filtro ligado.
    const neutro = filterSegmentClass(true, filterSegmentRole(null))
    const cortando = filterSegmentClass(true, filterSegmentRole("all"))
    expect(neutro).not.toBe(cortando)
    expect(neutro).not.toMatch(/rose/)
  })

  it("nenhum segmentado de filtro monta o próprio tom", () => {
    // A causa não foi a cor escolhida — foi ela ser escrita DENTRO do componente e viajar de
    // carona no reuso. Este teste corta a fonte de cada segmentado e falha se qualquer classe
    // de fundo aparecer ali dentro em vez de vir do dono.
    const alvos = [
      ["components/ranking/ranking-filters.tsx", "FilterSegment"],
      ["components/ranking/ranking-filters.tsx", "AdultContentSegment"],
      ["components/titles/title-filters.tsx", "AdultContentSegment"],
    ] as const

    for (const [arquivo, componente] of alvos) {
      const src = ler(arquivo)
      const inicio = src.indexOf(`function ${componente}(`)
      expect(inicio, `${componente} sumiu de ${arquivo} — reveja este teste`).toBeGreaterThan(-1)
      const fim = src.indexOf("\n}\n", inicio)
      const corpo = src.slice(inicio, fim)

      expect(corpo, `${componente} não deriva o tom do dono`).toContain("filterSegmentClass(")
      expect(corpo, `${componente} monta classe de fundo própria`).not.toMatch(/\bbg-(rose|red|primary|emerald|amber)/)
    }
  })

  it("o botão do painel decide a cor pelo mesmo valor que ele grava", () => {
    // Um `cuts` booleano por call site é o caminho de volta ao defeito: o próximo botão
    // adicionado nasce com o flag errado e ninguém percebe.
    const src = ler("components/ranking/ranking-filters.tsx")
    const inicio = src.indexOf("function FilterSegment(")
    const corpo = src.slice(inicio, src.indexOf("\n}\n", inicio))
    expect(corpo).toContain("filterSegmentRole(value)")
    expect(corpo).toContain("onSelect(value)")
  })
})
