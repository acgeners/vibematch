import { describe, expect, it } from "vitest"
import { getSourceMatchGroups } from "@/components/titles/external-search"
import { SELECTABLE_EXTERNAL_SOURCES, sourceOrderIndex } from "@/lib/external/source-order"
import type { MergedCandidate, ExternalSourceCandidateOption, ExternalSourceId } from "@/lib/external/types"

// Caso real (medido 2026-07-24): o Mangago hospeda DUAS páginas da mesma obra coreana
// — o upload mantido (`i_caught_the_male_lead_on_a_deserted_island`, Ch.48) e um
// abandonado (`reeling_in_the_male_lead`, Ch.10). As duas voltam com o MESMO título e
// match 1.00. Antes, a tela mostrava duas linhas idênticas e a pré-seleção era a ordem
// em que a fonte devolveu — que aqui é a errada.

function option(
  externalId: string,
  extra: Partial<ExternalSourceCandidateOption> = {}
): ExternalSourceCandidateOption {
  return {
    source: "mangago",
    externalId,
    title: "Reeling in the Male Lead",
    coverUrl: null,
    matchScore: 1,
    synopsis: null,
    year: null,
    chapters: null,
    ...extra,
  }
}

function candidate(options: ExternalSourceCandidateOption[]): MergedCandidate {
  return {
    title: "Reeling in the Male Lead",
    sources: [...new Set(options.map((o) => o.source))],
    sourceResults: [],
    sourceCandidates: options,
  }
}

const mangago = (c: MergedCandidate) => getSourceMatchGroups(c).find((g) => g.source === "mangago")!

describe("getSourceMatchGroups — duplicata na MESMA fonte", () => {
  it("desempata pelo maior último capítulo (a entrada mantida vem 1ª e é a pré-selecionada)", () => {
    // Ordem de ENTRADA é a errada de propósito: a abandonada primeiro.
    const group = mangago(
      candidate([
        option("reeling_in_the_male_lead", { latestChapter: 10 }),
        option("i_caught_the_male_lead_on_a_deserted_island", { latestChapter: 48 }),
      ])
    )
    expect(group.options.map((o) => o.externalId)).toEqual([
      "i_caught_the_male_lead_on_a_deserted_island",
      "reeling_in_the_male_lead",
    ])
  })

  it("matchScore continua mandando mais que o capítulo", () => {
    const group = mangago(
      candidate([
        option("fraca", { latestChapter: 900, matchScore: 0.7 }),
        option("forte", { latestChapter: 3, matchScore: 1 }),
      ])
    )
    expect(group.options[0].externalId).toBe("forte")
  })

  it("sinaliza quantas entradas com o mesmo título a fonte devolveu", () => {
    const group = mangago(
      candidate([
        option("a", { latestChapter: 48 }),
        option("b", { latestChapter: 10 }),
      ])
    )
    expect(group.duplicateCount).toBe(2)
  })

  it("títulos diferentes na mesma fonte NÃO são duplicata (não vira aviso)", () => {
    const group = mangago(
      candidate([
        option("a", { latestChapter: 48 }),
        option("b", { title: "70% of Overtime Workers Will Have Sex", latestChapter: 145 }),
      ])
    )
    expect(group.duplicateCount).toBe(0)
  })

  it("difere só por capitalização/pontuação ⇒ ainda é duplicata", () => {
    const group = mangago(
      candidate([
        option("a", { title: "Reeling in the Male Lead", latestChapter: 48 }),
        option("b", { title: "Reeling In The Male Lead!", latestChapter: 10 }),
      ])
    )
    expect(group.duplicateCount).toBe(2)
  })

  it("uma entrada só: sem aviso", () => {
    expect(mangago(candidate([option("a", { latestChapter: 48 })])).duplicateCount).toBe(0)
  })

  it("sem último capítulo em nenhuma, a ordem por matchScore é preservada (não vira NaN)", () => {
    const group = mangago(candidate([option("a"), option("b")]))
    expect(group.options.map((o) => o.externalId)).toEqual(["a", "b"])
    expect(group.duplicateCount).toBe(2)
  })

  it("quem tem capítulo ganha de quem não tem (undefined não vence)", () => {
    const group = mangago(candidate([option("sem"), option("com", { latestChapter: 1 })]))
    expect(group.options[0].externalId).toBe("com")
  })
})

// ---------------------------------------------------------------------------
// Ordem fixa e nenhuma fonte sumindo
// ---------------------------------------------------------------------------
// Antes só saíam as fontes COM resultado ⇒ a lista mudava de tamanho e de ordem a
// cada busca. E o `SOURCE_ORDER` local havia esquecido o `mangago`: por ser
// `indexOf`, ele virava −1 e ia pro TOPO, antes de todas as outras.
//
// A ordem esperada é `SELECTABLE_EXTERNAL_SOURCES` (que sai da tabela `source` do DB
// via sync-constants) — de propósito, NÃO uma lista hardcoded: o teste garante que os
// grupos saem NA ordem canônica, seja ela qual for, e não trava numa ordem específica
// que o próximo sync mudaria.
describe("getSourceMatchGroups — ordem e presença das fontes", () => {
  const ORDEM_ESPERADA = [...SELECTABLE_EXTERNAL_SOURCES]

  it("devolve TODAS as fontes selecionáveis, mesmo sem nenhum resultado", () => {
    const groups = getSourceMatchGroups({ title: "X", sources: [], sourceResults: [] })
    expect(groups.map((g) => g.source)).toEqual(ORDEM_ESPERADA)
    expect(groups).toHaveLength(SELECTABLE_EXTERNAL_SOURCES.length)
  })

  it("`outros` (catch-all) fica fora do diálogo", () => {
    const groups = getSourceMatchGroups({ title: "X", sources: [], sourceResults: [] })
    expect(groups.some((g) => g.source === "outros")).toBe(false)
  })

  it("a ordem NÃO muda quando só algumas fontes acham a obra", () => {
    const groups = getSourceMatchGroups(
      candidate([option("m", { latestChapter: 5 }), option("a", { source: "anilist" })])
    )
    expect(groups.map((g) => g.source)).toEqual(ORDEM_ESPERADA)
  })

  it("Mangago fica na posição canônica, não furando a fila pro topo (era o bug do indexOf = −1)", () => {
    const groups = getSourceMatchGroups(candidate([option("m", { latestChapter: 5 })]))
    // Onde quer que o mangago esteja na ordem canônica, é AÍ que ele aparece — e o 1º
    // grupo é o 1º da ordem canônica, nunca o mangago empurrado pra frente pelo −1.
    expect(groups[0].source).toBe(SELECTABLE_EXTERNAL_SOURCES[0])
    const canonicalMangagoPos = SELECTABLE_EXTERNAL_SOURCES.indexOf("mangago")
    expect(groups.findIndex((g) => g.source === "mangago")).toBe(canonicalMangagoPos)
  })

  it("fonte desconhecida vai pro FIM da ordem, não pro começo", () => {
    // É a proteção que faltava: −1 ordenava antes de tudo.
    expect(sourceOrderIndex("fonte-que-nao-existe")).toBeGreaterThan(sourceOrderIndex("mangago"))
  })
})

describe("getSourceMatchGroups — estado de cada fonte", () => {
  const state = (source: ExternalSourceId, failed: ExternalSourceId[] = []) =>
    getSourceMatchGroups(candidate([option("m", { latestChapter: 5 })]), failed).find(
      (g) => g.source === source
    )!.state

  it("com resultado → ok", () => {
    expect(state("mangago")).toBe("ok")
  })

  it("sem resultado e sem falha → empty (a fonte respondeu: não tem a obra)", () => {
    expect(state("kitsu")).toBe("empty")
  })

  it("sem resultado PORQUE a busca falhou → failed (retentável, não é resposta)", () => {
    expect(state("kitsu", ["kitsu"])).toBe("failed")
  })

  it("falha numa fonte não contamina o estado das outras", () => {
    expect(state("mangadex", ["kitsu"])).toBe("empty")
  })

  it("uma fonte que ACHOU não é marcada como falha mesmo se constar em failedSources", () => {
    // Pode acontecer numa 2ª passada dirigida: a 1ª falhou, o refine achou. O que
    // vale é ter resultado — senão a tela pediria retry de algo que já veio.
    expect(state("mangago", ["mangago"])).toBe("ok")
  })
})
