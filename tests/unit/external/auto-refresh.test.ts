import { describe, it, expect } from "vitest"
import { buildAutoRefreshPlan, buildPlatformRatings } from "@/lib/external/auto-refresh"
import type { ConflictField, ExternalWorkData } from "@/lib/external/types"

const base: ExternalWorkData = {
  title: "Título das Fontes",
  originalTitle: "原題",
  synopsis: "Sinopse vinda das fontes.",
  coverUrl: "https://cdn/fonte.jpg",
  publicationStatus: "Completed",
  totalChapters: 120,
  genres: ["Action"],
  tags: ["Revenge"],
  muRating: 8.4,
  muVotes: 1200,
  externalIds: { mangaupdates: "123", comick: "abc" },
  fieldProvenance: {
    publicationStatus: [{ value: "Completed", sources: ["mangaupdates"] }],
  },
} as ExternalWorkData

describe("buildAutoRefreshPlan — a fronteira do Assinante", () => {
  it("atualiza o que ENVELHECE: status, capítulos, tags, IDs, notas de plataforma", () => {
    const { updates } = buildAutoRefreshPlan(base, [], "Ongoing")

    expect(updates.publicationStatus).toBe("Completed")
    expect(updates.totalChapters).toBe(120)
    expect(updates.genres).toEqual(["Action"])
    expect(updates.tags).toEqual(["Revenge"])
    expect(updates.externalIds).toEqual({ mangaupdates: "123", comick: "abc" })
    expect(updates.platformRatings).toEqual([
      { platform: "mangaupdates", rating: 8.4, votes: 1200 },
    ])
  })

  it("NUNCA grava o que é ESCOLHA — título, sinopse e capa não saem do Curador", () => {
    const { updates } = buildAutoRefreshPlan(base, [], "Ongoing")
    const written = Object.keys(updates)

    // Se qualquer um destes aparecer, o Assinante passou a poder sobrescrever a
    // curadoria na obra COMPARTILHADA — sem reversão por usuário.
    expect(written).not.toContain("title")
    expect(written).not.toContain("originalTitle")
    expect(written).not.toContain("synopsis")
    expect(written).not.toContain("synopses")
    expect(written).not.toContain("coverUrl")
    expect(written).not.toContain("covers")
  })

  it("campo em CONFLITO é pulado — sem humano pra decidir, preserva o que está salvo", () => {
    const conflicts = [{ field: "totalChapters", label: "Capítulos", options: [] }] as unknown as ConflictField[]

    const { updates, skippedConflicts } = buildAutoRefreshPlan(base, conflicts, "Ongoing")

    expect(updates.totalChapters).toBeUndefined()
    expect(skippedConflicts).toEqual(["totalChapters"])

    // O que não conflita segue atualizando — o conflito não paralisa a obra inteira.
    expect(updates.tags).toEqual(["Revenge"])
    expect(updates.platformRatings).toBeDefined()
  })

  it("dado ausente na fonte não vira escrita (não apaga o que já existe)", () => {
    const vazio = { title: "X", genres: [], tags: [] } as ExternalWorkData
    const { updates } = buildAutoRefreshPlan(vazio, [], "Ongoing")
    expect(updates).toEqual({})
  })
})

// O status de publicação é a exceção ao "conflito ⇒ não toca": ele segue a regra única
// (`decidePublicationStatus`), a mesma da checagem da /reading.
describe("buildAutoRefreshPlan — status pela regra única", () => {
  // O caso medido em 2026-11-09: MangaUpdates diz Completed, a AniList ainda diz Ongoing e o
  // Comix diz "releasing" (Unknown). Antes, o conflito fazia este caminho não gravar nada.
  const discordando = {
    ...base,
    fieldProvenance: {
      publicationStatus: [
        { value: "Completed", sources: ["mangaupdates"] },
        { value: "Ongoing", sources: ["anilist"] },
        { value: "Unknown", sources: ["comix"] },
      ],
    },
  } as ExternalWorkData
  const conflitoDeStatus = [
    { field: "publicationStatus", label: "Status", options: [] },
  ] as unknown as ConflictField[]

  it("as fontes discordam e o MangaUpdates decide: grava Completed", () => {
    const { updates, skippedConflicts } = buildAutoRefreshPlan(discordando, conflitoDeStatus, "Ongoing")
    expect(updates.publicationStatus).toBe("Completed")
    expect(skippedConflicts).not.toContain("publicationStatus")
  })

  it("nunca tira uma obra de Completed, mesmo sem conflito", () => {
    const voltou = {
      ...base,
      publicationStatus: "Ongoing",
      fieldProvenance: { publicationStatus: [{ value: "Ongoing", sources: ["mangaupdates", "anilist"] }] },
    } as ExternalWorkData
    expect(buildAutoRefreshPlan(voltou, [], "Completed").updates.publicationStatus).toBeUndefined()
  })

  it("status só de outra fonte (sem MangaUpdates nem Comix) não é gravado", () => {
    const soAniList = {
      ...base,
      fieldProvenance: { publicationStatus: [{ value: "Completed", sources: ["anilist"] }] },
    } as ExternalWorkData
    expect(buildAutoRefreshPlan(soAniList, [], "Ongoing").updates.publicationStatus).toBeUndefined()
  })

  it("fim do hiato pelo MangaUpdates: Hiatus → Ongoing", () => {
    const voltou = {
      ...base,
      fieldProvenance: { publicationStatus: [{ value: "Ongoing", sources: ["mangaupdates"] }] },
    } as ExternalWorkData
    expect(buildAutoRefreshPlan(voltou, [], "Hiatus").updates.publicationStatus).toBe("Ongoing")
  })
})

describe("buildPlatformRatings", () => {
  it("junta as notas por fonte e ignora plataforma sem nota nem voto", () => {
    const data = {
      title: "X",
      genres: [],
      tags: [],
      muRating: 8,
      muVotes: 10,
      cmxRating: null,
      cmxVotes: 0,
      externalPlatformRatings: [{ platform: "anilist", rating: 7.5, votes: 300 }],
    } as unknown as ExternalWorkData

    expect(buildPlatformRatings(data)).toEqual([
      { platform: "anilist", rating: 7.5, votes: 300 },
      { platform: "mangaupdates", rating: 8, votes: 10 },
    ])
  })
})
