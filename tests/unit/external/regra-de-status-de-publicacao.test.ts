import { describe, it, expect } from "vitest"
import {
  decidePublicationStatus,
  statusBySource,
  statusByTranslation,
  translationBehind,
  STALE_ONE_CHAPTER_DAYS,
} from "@/lib/external/publication-status-sync"
import { declaresFinalTotal, mapStatus, originalChaptersFromStatus } from "@/lib/external/mangaupdates"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"
import { CATALOG_SYNC_STATUSES } from "@/server/queries/catalog-sync"

// A regra ÚNICA de status: vale para a /reading, o lote do catálogo e o "Atualizar automático".
// Desde 2026-11-16 o status é o da TRADUÇÃO disponível. O que cada caso guarda está no nome dele.

describe("decidePublicationStatus — quem decide", () => {
  it("o MangaUpdates vence o Comix", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed", comix: "Hiatus" })).toEqual({
      status: "Completed",
      source: "mangaupdates",
    })
  })

  it("sem MangaUpdates, o Comix decide", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: null, comix: "Hiatus" })).toEqual({
      status: "Hiatus",
      source: "comix",
    })
  })

  it("'Unknown' não é opinião: o Comix dizendo 'releasing' não muda nada", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: null, comix: "Unknown" })).toBeNull()
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Unknown", comix: "Completed" })).toEqual({
      status: "Completed",
      source: "comix",
    })
  })

  it("mesmo status que o gravado: nada a gravar", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: "Hiatus" })).toBeNull()
  })
})

describe("decidePublicationStatus — quem tira uma obra de Completed ou Cancelled", () => {
  it("o Comix nunca tira", () => {
    for (const current of ["Completed", "Cancelled"]) {
      for (const status of ["Ongoing", "Hiatus", "Cancelled", "Completed"]) {
        expect(decidePublicationStatus(current, { mangaupdates: null, comix: status })).toBeNull()
      }
    }
  })

  it("o MangaUpdates tira: obra marcada concluída com o original em andamento volta a Ongoing", () => {
    // Caso medido em 16/11: 10 obras presas em Completed com o MangaUpdates dizendo Ongoing.
    expect(decidePublicationStatus("Completed", { mangaupdates: "Ongoing", comix: "Completed" })).toEqual({
      status: "Ongoing",
      source: "mangaupdates",
    })
    expect(decidePublicationStatus("Cancelled", { mangaupdates: "Hiatus" })?.status).toBe("Hiatus")
  })

  it("'Ongoing' nunca vem do Comix", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: null, comix: "Ongoing" })).toBeNull()
  })
})

describe("o status é o da TRADUÇÃO", () => {
  const atrasada = { originalChapters: 78, availableChapters: 29 }
  const emDia = { originalChapters: 84, availableChapters: 84 }

  it("original concluído com capítulo por traduzir: em andamento", () => {
    expect(statusByTranslation("Completed", atrasada)).toBe("Ongoing")
    expect(decidePublicationStatus("Completed", { mangaupdates: "Completed" }, atrasada)?.status).toBe("Ongoing")
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed" }, atrasada)).toBeNull()
  })

  it("tradução alcançou o original: concluída", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed" }, emDia)?.status).toBe("Completed")
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed" }, { originalChapters: 84, availableChapters: 90 })?.status).toBe(
      "Completed",
    )
  })

  it("hiato e cancelamento do original também esperam a tradução alcançar", () => {
    expect(statusByTranslation("Hiatus", atrasada)).toBe("Ongoing")
    expect(statusByTranslation("Cancelled", atrasada)).toBe("Ongoing")
    expect(statusByTranslation("Hiatus", emDia)).toBe("Hiatus")
  })

  it("sem as duas contagens, fica o status do original", () => {
    expect(statusByTranslation("Completed", undefined)).toBe("Completed")
    expect(statusByTranslation("Completed", { originalChapters: 78, availableChapters: null })).toBe("Completed")
    expect(statusByTranslation("Completed", { originalChapters: null, availableChapters: 29 })).toBe("Completed")
  })

  it("a contagem só traduz o status do MangaUpdates, nunca o do Comix", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: null, comix: "Completed" }, atrasada)?.status).toBe("Completed")
  })
})

describe("tolerância de 1 capítulo (numeração × capítulo faltando)", () => {
  // Regra da Ana (16/11): 1 capítulo de diferença, total declarado FINAL no MangaUpdates e mais de
  // 3 meses sem lançamento ⇒ concluída. Casos reais: "Don't Give Cookies to Hungry Wolves" (7 de 8,
  // 330 dias parada) conclui; "The Pearl of Albrecht" (49 de 50, lançou há 8 dias) segue em andamento.
  const now = new Date("2026-11-16T00:00:00Z")
  const diasAtras = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const base = { originalChapters: 8, availableChapters: 7, finalTotalDeclared: true, now }

  it("parada há mais de 3 meses: concluída", () => {
    expect(translationBehind({ ...base, lastReleaseAt: diasAtras(330) })).toBe(false)
    expect(statusByTranslation("Completed", { ...base, lastReleaseAt: diasAtras(330) })).toBe("Completed")
  })

  it("lançou há pouco: segue em andamento (o final pode estar a caminho)", () => {
    expect(translationBehind({ ...base, lastReleaseAt: diasAtras(8) })).toBe(true)
    expect(translationBehind({ ...base, lastReleaseAt: diasAtras(STALE_ONE_CHAPTER_DAYS - 1) })).toBe(true)
  })

  it("sem a data, sem tolerância", () => {
    expect(translationBehind({ ...base, lastReleaseAt: null })).toBe(true)
  })

  it("total que NÃO é declarado final (hiato, só o que saiu): sem tolerância", () => {
    expect(translationBehind({ ...base, finalTotalDeclared: false, lastReleaseAt: diasAtras(916) })).toBe(true)
  })

  it("só vale para 1 capítulo", () => {
    expect(translationBehind({ ...base, availableChapters: 6, lastReleaseAt: diasAtras(400) })).toBe(true)
  })

  it("o MangaUpdates declara o total como final só na primeira linha, com 'Complete'", () => {
    expect(declaresFinalTotal("8 Chapters (Complete)")).toBe(true)
    expect(declaresFinalTotal("60 Chapters + Prologue (Complete)")).toBe(true)
    expect(declaresFinalTotal("150 Chapters   (Complete)\n\nS1: 48 Chapters (1-48)")).toBe(true)
    expect(declaresFinalTotal("41 Chapters (*Hiatus since 3/2026*)")).toBe(false)
    expect(declaresFinalTotal("68 Chapters (Cancelled)")).toBe(false)
    expect(declaresFinalTotal("5 Volumes (Ongoing)\n111 Chapters + Prologue (Complete)")).toBe(false)
    expect(declaresFinalTotal("S1: 41 Chapters (Complete)")).toBe(false)
    // Só a temporada 1 está completa; a obra segue saindo. O "(Complete)" de baixo não é do total.
    expect(declaresFinalTotal("80 Chapters (Ongoing)\n\nS1: 40 Chapters (Complete) (1-40)")).toBe(false)
    expect(declaresFinalTotal(undefined)).toBe(false)
  })
})

describe("o total do original vem do MangaUpdates", () => {
  it("do cabeçalho do status", () => {
    expect(originalChaptersFromStatus("78 Chapters (Complete)")).toBe(78)
    expect(originalChaptersFromStatus("150 Chapters   (Complete)\n\nS1: 48 Chapters (1-48)")).toBe(150)
    // Sem número no início não há total: "S1: 41 chapters" é só a 1ª temporada.
    expect(originalChaptersFromStatus("S1: 41 chapters")).toBeNull()
    expect(originalChaptersFromStatus("**Main Story:** 25 Chapters (1~25)")).toBeNull()
  })

  it("'Incomplete' não é 'Complete'", () => {
    expect(mapStatus("108 Chapters (Unfinished/Incomplete; Artist dropped after Season 3)")).not.toBe("Completed")
    expect(mapStatus("110 Chapters (Completed)")).toBe("Completed")
  })
})

describe("decidePublicationStatus — fim do hiato e status desconhecido", () => {
  it("Hiatus → Ongoing quando o MangaUpdates diz que voltou", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: "Ongoing", comix: "Hiatus" })).toEqual({
      status: "Ongoing",
      source: "mangaupdates",
    })
  })

  it("obra sem status conhecido recebe o do MangaUpdates, inclusive Ongoing", () => {
    expect(decidePublicationStatus("Unknown", { mangaupdates: "Ongoing" })?.status).toBe("Ongoing")
    expect(decidePublicationStatus(null, { mangaupdates: "Ongoing" })?.status).toBe("Ongoing")
  })

  it("em andamento → concluída ou em hiato", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed" })?.status).toBe("Completed")
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Hiatus" })?.status).toBe("Hiatus")
  })
})

describe("statusBySource", () => {
  it("lê o status de cada fonte na procedência do merge", () => {
    expect(
      statusBySource([
        { value: "Completed", sources: ["mangaupdates", "kitsu"] },
        { value: "Unknown", sources: ["comix"] },
        { value: "Ongoing", sources: ["anilist"] },
      ]),
    ).toEqual({ mangaupdates: "Completed", comix: "Unknown" })
  })

  it("sem procedência, nenhuma fonte opina", () => {
    expect(statusBySource(undefined)).toEqual({ mangaupdates: null, comix: null })
  })
})

describe("o universo do lote do catálogo", () => {
  it("são as obras em andamento, em hiato ou sem status — nunca concluídas ou canceladas", () => {
    expect([...CATALOG_SYNC_STATUSES].sort()).toEqual(["Hiatus", "Ongoing", "Unknown"])
  })

  it("todo status do lote existe no banco (renomear um no Supabase reprova aqui)", () => {
    for (const status of CATALOG_SYNC_STATUSES) {
      expect(getPublicationStatusIdByName(status), status).not.toBeNull()
    }
  })
})
