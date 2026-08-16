import { describe, expect, it } from "vitest"

import {
  chapterCeiling,
  chaptersForFullyRead,
  clampChaptersRead,
  evaluateReadingCoherence,
  promoteStatusForProgress,
} from "@/lib/reading/status-coherence"
import { PERSONAL_STATUSES_BY_ID, PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"

/** Ids resolvidos do dado gerado — nada de número mágico: se a tabela mudar, o teste explica. */
function personalIdBySlug(slug: string): number {
  const info = Object.values(PERSONAL_STATUSES_BY_ID).find((s) => s.slug === slug)
  if (!info) throw new Error(`personal_status sem slug "${slug}" — rode sync-constants`)
  return info.id
}

function publicationIdBySlug(slug: string): number {
  const info = Object.values(PUBLICATION_STATUSES_BY_ID).find((s) => s.slug === slug)
  if (!info) throw new Error(`publication_status sem slug "${slug}" — rode sync-constants`)
  return info.id
}

const FINISHED = personalIdBySlug("finished")
const READING = personalIdBySlug("reading")
const DROPPED = personalIdBySlug("dropped")
const UNTRACKED = personalIdBySlug("untracked")
const WANT_TO_READ = personalIdBySlug("want-to-read")
const NOT_NOW = personalIdBySlug("not_now")
const READ_AGAIN = personalIdBySlug("read_again")

const ONGOING = publicationIdBySlug("ongoing")
const PUB_HIATUS = publicationIdBySlug("hiatus")
const COMPLETED = publicationIdBySlug("completed")
const CANCELLED = publicationIdBySlug("cancelled")
const UNKNOWN = publicationIdBySlug("unknown")

describe("clampChaptersRead", () => {
  it("limita ao total conhecido e sinaliza que limitou", () => {
    expect(clampChaptersRead(40, 26)).toEqual({ value: 26, requested: 40, clamped: true })
  })

  it("não mexe no que cabe", () => {
    expect(clampChaptersRead(18, 26)).toEqual({ value: 18, requested: 18, clamped: false })
  })

  it("sem total conhecido não há teto", () => {
    expect(clampChaptersRead(400, null)).toEqual({ value: 400, requested: 400, clamped: false })
    expect(clampChaptersRead(400, 0)).toEqual({ value: 400, requested: 400, clamped: false })
  })

  it("piso é zero, e lixo digitado vira zero em vez de NaN", () => {
    expect(clampChaptersRead(-3, 26).value).toBe(0)
    expect(clampChaptersRead(Number.NaN, 26).value).toBe(0)
    expect(clampChaptersRead(null, 26).value).toBe(0)
  })

  it("trunca decimal (capítulo é inteiro)", () => {
    expect(clampChaptersRead(12.9, 26).value).toBe(12)
  })
})

describe("chapterCeiling", () => {
  it("normalmente é o total do catálogo", () => {
    expect(chapterCeiling(26, 6)).toBe(26)
  })

  it("progresso ACIMA do total vira o teto — catálogo defasado não apaga leitura real", () => {
    // "Marcar até o último lançado" da /reading grava 132 numa obra que o catálogo diz ter 120.
    expect(chapterCeiling(120, 132)).toBe(132)
    expect(clampChaptersRead(132, chapterCeiling(120, 132)).value).toBe(132)
  })

  it("sem total, o teto é o próprio progresso; sem nada, não há teto", () => {
    expect(chapterCeiling(null, 40)).toBe(40)
    expect(chapterCeiling(null, null)).toBeNull()
    expect(chapterCeiling(0, 0)).toBeNull()
  })
})

describe("chaptersForFullyRead", () => {
  it("Finished com progresso parcial completa até o total — o caso do print", () => {
    expect(chaptersForFullyRead({ personalStatus: FINISHED, chaptersRead: 6, totalChapters: 26 })).toBe(26)
  })

  it("Finished já no fim não gera escrita", () => {
    expect(chaptersForFullyRead({ personalStatus: FINISHED, chaptersRead: 26, totalChapters: 26 })).toBeNull()
  })

  it("Dropped é terminal mas NÃO é 'leu tudo'", () => {
    expect(chaptersForFullyRead({ personalStatus: DROPPED, chaptersRead: 6, totalChapters: 26 })).toBeNull()
  })

  it("sem total conhecido não inventa número", () => {
    expect(chaptersForFullyRead({ personalStatus: FINISHED, chaptersRead: 6, totalChapters: null })).toBeNull()
  })
})

describe("promoteStatusForProgress", () => {
  const reading = PERSONAL_STATUSES_BY_ID[READING].status

  it("marcar capítulo numa obra Untracked promove pra Reading", () => {
    expect(promoteStatusForProgress({ personalStatus: UNTRACKED, chaptersRead: 6 }, "chapters")).toBe(reading)
  })

  it("vale pros quatro 'não comecei'", () => {
    for (const id of [WANT_TO_READ, UNTRACKED, NOT_NOW, personalIdBySlug("not_interested")]) {
      expect(promoteStatusForProgress({ personalStatus: id, chaptersRead: 1 }, "chapters")).toBe(reading)
    }
  })

  it("obra sem linha nenhuma (null) conta como 'não comecei'", () => {
    expect(promoteStatusForProgress({ personalStatus: null, chaptersRead: 3 }, "chapters")).toBe(reading)
  })

  it("ESCOLHER Untracked numa obra lida NÃO é promovido — senão ninguém destrackeia o que leu", () => {
    expect(promoteStatusForProgress({ personalStatus: UNTRACKED, chaptersRead: 26 }, "status")).toBeNull()
    expect(promoteStatusForProgress({ personalStatus: NOT_NOW, chaptersRead: 26 }, "status")).toBeNull()
  })

  it("o default ('não comecei' por ausência) é promovido pelos DOIS lados — comportamento antigo do form", () => {
    expect(promoteStatusForProgress({ personalStatus: WANT_TO_READ, chaptersRead: 1 }, "status")).toBe(reading)
  })

  it("status que acompanha progresso fica como está", () => {
    expect(promoteStatusForProgress({ personalStatus: FINISHED, chaptersRead: 26 }, "chapters")).toBeNull()
    expect(promoteStatusForProgress({ personalStatus: READ_AGAIN, chaptersRead: 2 }, "chapters")).toBeNull()
    expect(promoteStatusForProgress({ personalStatus: READING, chaptersRead: 2 }, "chapters")).toBeNull()
  })

  it("zero capítulo não promove nada", () => {
    expect(promoteStatusForProgress({ personalStatus: UNTRACKED, chaptersRead: 0 }, "chapters")).toBeNull()
    expect(promoteStatusForProgress({ personalStatus: UNTRACKED, chaptersRead: null }, "chapters")).toBeNull()
  })
})

describe("evaluateReadingCoherence", () => {
  it("Finished numa obra Ongoing avisa e sugere 'em dia'", () => {
    const issue = evaluateReadingCoherence({
      personalStatus: FINISHED,
      publicationStatusId: ONGOING,
      chaptersRead: 26,
      totalChapters: 26,
    })
    expect(issue).toMatchObject({
      kind: "finished-while-publishing",
      publicationStatus: PUBLICATION_STATUSES_BY_ID[ONGOING].status,
      suggestedStatus: PERSONAL_STATUSES_BY_ID[READING].status,
    })
  })

  it("publicação em Hiatus conta como 'ainda saindo'", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: FINISHED,
        publicationStatusId: PUB_HIATUS,
        chaptersRead: 26,
        totalChapters: 26,
      })?.kind,
    ).toBe("finished-while-publishing")
  })

  it("Dropped numa obra em publicação é legítimo", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: DROPPED,
        publicationStatusId: ONGOING,
        chaptersRead: 6,
        totalChapters: 26,
      }),
    ).toBeNull()
  })

  it("Cancelled e Unknown não geram aviso nem sugestão", () => {
    for (const pub of [CANCELLED, UNKNOWN]) {
      expect(
        evaluateReadingCoherence({
          personalStatus: FINISHED,
          publicationStatusId: pub,
          chaptersRead: 26,
          totalChapters: 26,
        }),
      ).toBeNull()
      expect(
        evaluateReadingCoherence({
          personalStatus: READING,
          publicationStatusId: pub,
          chaptersRead: 26,
          totalChapters: 26,
        }),
      ).toBeNull()
    }
  })

  it("último capítulo de obra concluída vira convite pra Finished", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: READING,
        publicationStatusId: COMPLETED,
        chaptersRead: 26,
        totalChapters: 26,
      }),
    ).toMatchObject({ kind: "finish-suggested", totalChapters: 26 })
  })

  it("não sugere quem já encerrou a leitura (Finished ou Dropped)", () => {
    for (const status of [FINISHED, DROPPED]) {
      expect(
        evaluateReadingCoherence({
          personalStatus: status,
          publicationStatusId: COMPLETED,
          chaptersRead: 26,
          totalChapters: 26,
        }),
      ).toBeNull()
    }
  })

  it("faltando capítulo, nada a sugerir", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: READING,
        publicationStatusId: COMPLETED,
        chaptersRead: 25,
        totalChapters: 26,
      }),
    ).toBeNull()
  })

  it("sem total conhecido nenhuma regra dispara", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: READING,
        publicationStatusId: COMPLETED,
        chaptersRead: 999,
        totalChapters: null,
      }),
    ).toBeNull()
  })

  it("obra sem publicação registrada é silêncio, não palpite", () => {
    expect(
      evaluateReadingCoherence({
        personalStatus: FINISHED,
        publicationStatusId: null,
        chaptersRead: 26,
        totalChapters: 26,
      }),
    ).toBeNull()
  })
})
