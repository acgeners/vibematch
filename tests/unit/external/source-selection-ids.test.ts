import { describe, expect, it } from "vitest"
import { buildCandidateFromSourceSelection } from "@/components/titles/external-search"
import type { MergedCandidate, ExternalSearchResult, ExternalSourceId } from "@/lib/external/types"

// O passo de confirmação do diálogo reconstrói o candidato do ZERO a partir das
// opções escolhidas, e cada fonte tem um CAMPO PRÓPRIO no candidato
// (`mangagoSlug`, `anilistId`, `comickHid`…). O `case "mangago"` FALTAVA no
// `applySelectedId`: escolher o Mangago aparecia certo na tela e o slug era
// descartado, então nunca chegava a `work_external_ids`. Nada estourava — o campo
// simplesmente ficava `undefined`.
//
// Estes casos cobrem TODAS as fontes de uma vez: se alguém adicionar uma fonte e
// esquecer o case, o teste (além da trava de compilação) acusa.

const ID_POR_FONTE: Array<{
  source: ExternalSourceId
  externalId: string
  field: keyof MergedCandidate
  expected: string | number
}> = [
  { source: "mangaupdates", externalId: "51623639373", field: "muId", expected: 51623639373 },
  { source: "anilist", externalId: "182852", field: "anilistId", expected: 182852 },
  { source: "myanimelist", externalId: "187068", field: "malId", expected: 187068 },
  { source: "animeplanet", externalId: "reeling-in-the-male-lead", field: "animePlanetSlug", expected: "reeling-in-the-male-lead" },
  { source: "kitsu", externalId: "73053", field: "kitsuId", expected: "73053" },
  { source: "comick", externalId: "QXTZweih", field: "comickHid", expected: "QXTZweih" },
  { source: "mangadex", externalId: "d41fe947-2e33", field: "mangadexId", expected: "d41fe947-2e33" },
  { source: "comix", externalId: "cmx123", field: "comixHid", expected: "cmx123" },
  { source: "mangago", externalId: "i_caught_the_male_lead_on_a_deserted_island", field: "mangagoSlug", expected: "i_caught_the_male_lead_on_a_deserted_island" },
]

function candidateWith(source: ExternalSourceId, externalId: string): MergedCandidate {
  const result: ExternalSearchResult = {
    id: `${source}:${externalId}`,
    source,
    title: "Reeling in the Male Lead",
  }
  return {
    title: "Reeling in the Male Lead",
    sources: [source],
    sourceResults: [result],
    sourceCandidates: [
      {
        source,
        externalId,
        title: "Reeling in the Male Lead",
        coverUrl: null,
        matchScore: 1,
        synopsis: null,
        year: null,
        chapters: null,
      },
    ],
  }
}

describe("buildCandidateFromSourceSelection — o id escolhido chega no candidato", () => {
  for (const { source, externalId, field, expected } of ID_POR_FONTE) {
    it(`${source} → ${String(field)}`, () => {
      const next = buildCandidateFromSourceSelection(candidateWith(source, externalId), {
        [source]: externalId,
      })
      expect(next).not.toBeNull()
      expect(next![field]).toBe(expected)
    })
  }

  it("nenhuma fonte escolhida → null (não segue com candidato vazio)", () => {
    const next = buildCandidateFromSourceSelection(candidateWith("mangago", "abc"), {
      mangago: "none",
    })
    expect(next).toBeNull()
  })

  it("fonte rejeitada não vira id", () => {
    const candidate = candidateWith("mangago", "abc")
    candidate.sourceCandidates!.push({
      source: "anilist",
      externalId: "1",
      title: "Reeling in the Male Lead",
      coverUrl: null,
      matchScore: 1,
      synopsis: null,
      year: null,
      chapters: null,
    })
    candidate.sources.push("anilist")
    const next = buildCandidateFromSourceSelection(candidate, {
      mangago: "rejected",
      anilist: "1",
    })
    expect(next?.mangagoSlug).toBeUndefined()
    expect(next?.anilistId).toBe(1)
  })
})
