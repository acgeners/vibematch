import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { mergeData } from "@/lib/external/index"
import type { ExternalSearchResult } from "@/lib/external/types"

/**
 * O status que o cadastro e o "Atualizar dados" propõem é o da TRADUÇÃO (decisão de 16/11):
 * com o MangaUpdates dizendo "78 Chapters (Complete)" e 29 capítulos disponíveis na Comix, a obra
 * entra como em andamento — senão nasceria Completed e o lote do catálogo nunca a olharia de novo
 * (ele percorre só Ongoing, Hiatus e Unknown).
 */

const candidate = { id: "c1", source: "mangaupdates", title: "I Chose the Wrong Man", muId: 1 } as never
const mu = (status: string, chapters: number): ExternalSearchResult =>
  ({ id: "mu:1", source: "mangaupdates", title: "I Chose the Wrong Man", publicationStatus: status, chapters }) as ExternalSearchResult
const comix = (chapters: number): ExternalSearchResult =>
  ({ id: "comix:x", source: "comix", title: "I Chose the Wrong Man", publicationStatus: "Completed", chapters }) as ExternalSearchResult

describe("mergeData — status proposto é o da tradução", () => {
  it("original concluído com capítulo por traduzir: em andamento", () => {
    const data = mergeData(candidate, [mu("Completed", 78), comix(29)], null, "78 Chapters (Complete)")
    expect(data.totalChapters).toBe(29)
    expect(data.publicationStatus).toBe("Ongoing")
  })

  it("tradução completa: concluída", () => {
    const data = mergeData(candidate, [mu("Completed", 78), comix(78)], null, "78 Chapters (Complete)")
    expect(data.publicationStatus).toBe("Completed")
  })

  it("sem o texto de status do MangaUpdates não há total do original: fica o status do original", () => {
    const data = mergeData(candidate, [mu("Completed", 78), comix(29)], null, undefined)
    expect(data.publicationStatus).toBe("Completed")
  })
})
