import { describe, it, expect } from "vitest"
import { tallySourceGaps, type SourceStateRow } from "@/lib/external/source-gaps"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * O núcleo da fila de "Fontes". Testa o que a query NÃO consegue provar sozinha (ela
 * depende do banco) e o que a árvore desenhada também não prova (a aba recebe os
 * contadores prontos, como PROP — um teste de render só garante que ela os exibe).
 */

const SOURCES = ["anilist", "kitsu", "mangadex"] as unknown as readonly ExternalSourceId[]
const [ANILIST, KITSU, MANGADEX] = SOURCES

const row = (work_id: string, source: ExternalSourceId, over: Partial<SourceStateRow> = {}): SourceStateRow => ({
  work_id,
  source,
  external_id: "x1",
  is_rejected: false,
  ...over,
})

describe("tallySourceGaps", () => {
  it("ausência de LINHA é lacuna — a fonte nunca avaliada não pode sumir", () => {
    // A obra só tem linha de AniList; Kitsu e MangaDex não existem na tabela.
    const t = tallySourceGaps({ workIds: ["w1"], rows: [row("w1", ANILIST)], sources: SOURCES })
    expect(t.perWork.get("w1")).toEqual({
      linked: [ANILIST],
      absent: [],
      gaps: [KITSU, MANGADEX],
    })
    expect(t.withGapsCount).toBe(1)
  })

  it("fonte declarada ausente sai da lacuna — é decisão tomada, não pendência", () => {
    const t = tallySourceGaps({
      workIds: ["w1"],
      rows: [
        row("w1", ANILIST),
        row("w1", KITSU, { external_id: null, is_rejected: true }),
        row("w1", MANGADEX),
      ],
      sources: SOURCES,
    })
    // Kitsu decidida ⇒ a obra fica SEM lacuna ⇒ sai da fila inteira. É isto que faz a
    // fila zerar: sem esse ramo, marcar "não existe aqui" não tiraria nada de lugar
    // nenhum e a aba viveria acusando o mesmo trabalho pra sempre.
    expect(t.perWork.has("w1")).toBe(false)
    expect(t.withGapsCount).toBe(0)
    expect(t.gapsBySource.find((g) => g.source === KITSU)!.missing).toBe(0)
  })

  it("declarar ausente uma fonte NÃO apaga as lacunas restantes da obra", () => {
    const t = tallySourceGaps({
      workIds: ["w1"],
      rows: [row("w1", ANILIST), row("w1", KITSU, { external_id: null, is_rejected: true })],
      sources: SOURCES,
    })
    expect(t.perWork.get("w1")).toEqual({ linked: [ANILIST], absent: [KITSU], gaps: [MANGADEX] })
    expect(t.withGapsCount).toBe(1)
  })

  it("obra sem lacuna nenhuma não entra na fila", () => {
    const rows = SOURCES.map((s) => row("w1", s))
    const t = tallySourceGaps({ workIds: ["w1"], rows, sources: SOURCES })
    expect(t.perWork.size).toBe(0)
    expect(t.withGapsCount).toBe(0)
  })

  /**
   * 🔴 A invariante que motivou extrair esta função. Contar DEPOIS do filtro zeraria os
   * outros chips e a aba deixaria de ser um mapa. A contraprova está no próprio caso:
   * com `filterSource=KITSU` a lista tem 1 obra, mas o AniList continua acusando 2.
   */
  it("o filtro de fonte recorta a LISTA e não mexe nos contadores do mapa", () => {
    const rows = [
      // w1: só falta Kitsu.        w2: falta AniList.       w3: falta AniList e MangaDex.
      row("w1", ANILIST), row("w1", MANGADEX),
      row("w2", KITSU), row("w2", MANGADEX),
      row("w3", KITSU),
    ]
    const semFiltro = tallySourceGaps({ workIds: ["w1", "w2", "w3"], rows, sources: SOURCES })
    expect(semFiltro.perWork.size).toBe(3)
    expect(semFiltro.withGapsCount).toBe(3)
    expect(semFiltro.gapsBySource).toEqual([
      { source: ANILIST, missing: 2 },
      { source: KITSU, missing: 1 },
      { source: MANGADEX, missing: 1 },
    ])

    const soKitsu = tallySourceGaps({
      workIds: ["w1", "w2", "w3"],
      rows,
      sources: SOURCES,
      filterSource: KITSU,
    })
    expect([...soKitsu.perWork.keys()]).toEqual(["w1"])
    // O mapa NÃO encolheu — é isto que mantém os outros chips clicáveis.
    expect(soKitsu.gapsBySource).toEqual(semFiltro.gapsBySource)
    expect(soKitsu.withGapsCount).toBe(3)
  })

  it("ignora fonte fora do universo (ex.: `outros`) em vez de contá-la como lacuna", () => {
    const t = tallySourceGaps({
      workIds: ["w1"],
      rows: [...SOURCES.map((s) => row("w1", s)), row("w1", "outros" as ExternalSourceId)],
      sources: SOURCES,
    })
    expect(t.withGapsCount).toBe(0)
    expect(t.gapsBySource.map((g) => g.source)).toEqual([...SOURCES])
  })
})
