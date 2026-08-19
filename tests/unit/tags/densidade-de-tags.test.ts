import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describeWorkTags, tagDensity, formatTagShare } from "@/lib/tags/density"
import { segmentTags, lowercasedNameSet } from "@/lib/tags/segment"
import type { TagStanceInfo } from "@/lib/tags/segment"

/**
 * A densidade responde "de tudo que descreve esta obra, que fatia é gosto meu?".
 * O que regride aqui é o DENOMINADOR — e ele mente sem erro nenhum, porque
 * qualquer número entre 0 e 100 é plausível.
 */

const love = (strong = false): TagStanceInfo => ({ stance: "love", strong, source: "declared" })
const avoid = (strong = false): TagStanceInfo => ({ stance: "avoid", strong, source: "declared" })

const tag = (name: string, stance: TagStanceInfo | null = null) => ({ name, stance })
const stanceOf = (t: { stance: TagStanceInfo | null }) => t.stance

describe("denominador", () => {
  it("é o conjunto que a nuvem de chips desenha — amadas + evitadas + resto", () => {
    // A invariante que importa: a mesma segmentação de que saem os chips é a que
    // divide o %. Duas contagens próprias divergiriam em silêncio, com a tela
    // mostrando "38%" ao lado de chips que somam outra coisa.
    const tags = [tag("a", love()), tag("b", avoid()), tag("c"), tag("d")]
    const seg = segmentTags(tags, stanceOf, lowercasedNameSet(["Romance"]))
    const d = tagDensity(seg)
    expect(d.total).toBe(seg.loved.length + seg.avoided.length + seg.rest.length)
    expect(d.total).toBe(4)
  })

  it("NÃO conta os gêneros — nem a tag homônima de um gênero, que sai da nuvem", () => {
    // "Romance" aparece em Categorias, não entre as tags: contá-lo no denominador
    // diluiria o % de toda obra proporcionalmente ao que ela tem de gênero.
    const tags = [tag("Romance", love()), tag("contract marriage", love()), tag("harem", avoid())]
    const { density } = describeWorkTags(["Romance", "Drama"], tags, stanceOf)
    expect(density.total).toBe(2)
    expect(density.loved).toBe(1)
    expect(density.lovedPct).toBe(50)
  })

  it("sem tag nenhuma, o percentual é null — nunca 0%", () => {
    // 0% afirma "nada aqui bate com você"; a ausência de tag não afirma nada.
    const { density } = describeWorkTags(["Romance"], [], stanceOf)
    expect(density.total).toBe(0)
    expect(density.lovedPct).toBeNull()
    expect(density.avoidedPct).toBeNull()
    expect(formatTagShare(density.lovedPct)).toBe("—")
  })

  it("a ênfase 2× não vale dois — é UMA tag amada", () => {
    // `segmentTags` ordena as fortes primeiro; a densidade conta cabeças.
    const tags = [tag("a", love(true)), tag("b", love()), tag("c")]
    expect(describeWorkTags([], tags, stanceOf).density.loved).toBe(2)
  })
})

describe("os casos medidos no catálogo (clone local, 2026-08-18)", () => {
  const denso = (total: number, loved: number, avoided: number) =>
    describeWorkTags(
      [],
      [
        ...Array.from({ length: loved }, (_, i) => tag(`l${i}`, love())),
        ...Array.from({ length: avoided }, (_, i) => tag(`a${i}`, avoid())),
        ...Array.from({ length: total - loved - avoided }, (_, i) => tag(`r${i}`)),
      ],
      stanceOf,
    ).density

  it("o absoluto recorde do catálogo é a MENOR fatia entre as duas obras", () => {
    // Elissa's Whirlwind Marriage: 65 amadas — o recorde — em 261 tags.
    // Villainess in Love: 45 em 80. Lado a lado, as duas mostram 5 chips verdes.
    const elissa = denso(261, 65, 2)
    const villainess = denso(80, 45, 1)
    expect(elissa.loved).toBeGreaterThan(villainess.loved)
    expect(formatTagShare(elissa.lovedPct)).toBe("25%")
    expect(formatTagShare(villainess.lovedPct)).toBe("56%")
    expect(elissa.lovedPct!).toBeLessThan(villainess.lovedPct!)
  })

  it("a obra sem nenhuma amada não vira '—'", () => {
    // Tomorrow's Thief: 33 tags, 0 amadas, 4 evitadas. 0% é um fato, e é o pior deles.
    const d = denso(33, 0, 4)
    expect(formatTagShare(d.lovedPct)).toBe("0%")
    expect(formatTagShare(d.avoidedPct)).toBe("12%")
  })
})

describe("formatTagShare", () => {
  it("nunca imprime 0% para uma fatia que existe", () => {
    // A menor fatia não-nula do catálogo é 1 tag em 261 = 0,38%. Arredondada para
    // "0%", ela contradiria o segmento de barra visível ao lado.
    expect(formatTagShare((100 * 1) / 261)).toBe("<1%")
    expect(formatTagShare(0)).toBe("0%")
    expect(formatTagShare(0.6)).toBe("1%")
    expect(formatTagShare(24.9)).toBe("25%")
    expect(formatTagShare(100)).toBe("100%")
  })
})

describe("uma fonte só no comparador", () => {
  const drawer = readFileSync(
    join(process.cwd(), "components/titles/work-compare-drawer.tsx"),
    "utf-8",
  )

  it("a linha em %, a nuvem de chips, a ordenação e o 'só diferenças' leem o MESMO objeto", () => {
    // Captura o identificador de que cada ponta deriva, em vez de casar o nome da
    // variável: o defeito desta família é uma ponta passando a contar por conta
    // própria, e aí o % discorda dos chips a dois centímetros dele.
    const fonte = drawer.match(/const (\w+) = \(w: CompareWork\) => \w+\.get\(w\.id\) \?\? describeWorkTags/)
    expect(fonte, "o breakdown por obra tem que ter um dono único").toBeTruthy()
    const nome = fonte![1]
    expect(drawer).toContain(`<TagDensityCell density={${nome}(w).density} />`)
    expect(drawer).toContain(`<GenresTagsCell genres={w.genres} breakdown={${nome}(w)} />`)
    expect(drawer).toContain(`get: (w: CompareWork) => ${nome}(w).density.lovedPct`)
    expect(drawer).toMatch(new RegExp(`tagsDensityVisible = isRowVisible\\("tags-density"[\\s\\S]{0,220}${nome}\\(w\\)\\.density`))
    // E a nuvem não pode voltar a segmentar sozinha.
    expect(drawer).not.toContain("segmentTags(")
  })

  it("o 'só diferenças' compara o que a célula IMPRIME, não o decimal cru", () => {
    // Mesma correção que Capítulos precisou: duas obras exibindo "38%" e "38%"
    // têm que sumir juntas, senão o filtro parece quebrado.
    expect(drawer).toMatch(/tagsDensityVisible[\s\S]{0,260}formatTagShare\(d\.lovedPct\)/)
  })
})
