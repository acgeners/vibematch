import { describe, expect, it } from "vitest"
import {
  clampAdultContentScore,
  computeAdultContentBounds,
  EXPLICIT_FLOOR,
  R15_FROM_R19_CEILING,
  R15_FROM_R19_TAG,
  ADULT_LABEL_FLOOR,
} from "@/lib/ai-evaluation/adult-content-rules"

// O piso/teto por tag vem de `tags.adult_score_tier` (migração 174), não mais de
// match por NOME — os testes passam o tier explicitamente, como a query real faz
// ao juntar `work_tags`/`tags`.
const explicitTag = (name: string) => ({ name, group: "content_indicator", scoreTier: "explicit" as const })
const labelTag = (name: string) => ({ name, group: "content_indicator", scoreTier: "label" as const })
const noTierTag = (name: string) => ({ name, group: "content_indicator", scoreTier: null })
const ci = (...names: string[]) => names.map((name) => noTierTag(name))

describe("marcador de EDIÇÃO não é limite", () => {
  it("[R19 disponível] sozinho não gera piso nem teto", () => {
    // O caso que motivou a mudança: 48% dos pisos vinham daqui. O marcador diz
    // "existe uma edição R19", não "esta obra é explícita".
    const b = computeAdultContentBounds({
      synopsis: "Rachel acorda dentro de um webnovel...\n\n[R19 disponível]",
      tags: ci(),
      genres: ["Fantasy", "Romance", "Shoujo"],
    })
    expect(b.floor).toBeNull()
    expect(b.ceiling).toBeNull()
    expect(b.hasEditionMarkerOnly).toBe(true)
  })

  it("linha solta 'R19' (boilerplate limpo) também não gera piso", () => {
    const b = computeAdultContentBounds({ synopsis: "Sinopse qualquer.\nR19\n", tags: ci() })
    expect(b.floor).toBeNull()
    expect(b.hasEditionMarkerOnly).toBe(true)
  })

  it("marcador + tag de ato explícito → o piso vem da TAG, não do marcador", () => {
    const b = computeAdultContentBounds({
      synopsis: "[R19 disponível]",
      tags: [explicitTag("Oral Sex")],
    })
    expect(b.floor).toBe(EXPLICIT_FLOOR)
    expect(b.hasEditionMarkerOnly).toBe(false)
  })
})

describe("texto livre NUNCA aciona limite", () => {
  it("a palavra 'smut' na sinopse não gera piso", () => {
    // A review que motivou tudo dizia "Romance and smut are lacking". Casar
    // keyword em texto livre acionaria o piso no caso em que a evidência diz o
    // oposto — por isso só sinal estruturado conta.
    const b = computeAdultContentBounds({
      synopsis: "Os leitores dizem que romance e smut são escassos nesta obra.",
      tags: ci(),
      genres: ["Romance"],
    })
    expect(b.floor).toBeNull()
  })

  it("tag com tier explicit FORA do grupo content_indicator não conta", () => {
    const b = computeAdultContentBounds({ tags: [{ name: "Oral Sex", group: "romance", scoreTier: "explicit" }] })
    expect(b.floor).toBeNull()
  })
})

describe("camada EXPLÍCITO: piso 9", () => {
  it("uma única tag de ato explícito (scoreTier=explicit) basta — frequência não rebaixa", () => {
    const b = computeAdultContentBounds({ tags: [explicitTag("Masturbation")] })
    expect(b.floor).toBe(EXPLICIT_FLOOR)
    expect(b.reasons.join(" ")).toMatch(/frequência muda o FOCO/i)
  })

  it("gênero Smut aciona", () => {
    expect(computeAdultContentBounds({ genres: ["Smut", "Romance"] }).floor).toBe(EXPLICIT_FLOOR)
  })

  it("classificação externa pornographic aciona", () => {
    expect(computeAdultContentBounds({ contentRatings: ["pornographic"] }).floor).toBe(EXPLICIT_FLOOR)
  })

  it("gênero 'Mature' NÃO aciona — cobre violência e tema adulto sem sexo", () => {
    expect(computeAdultContentBounds({ genres: ["Mature", "Drama"] }).floor).toBeNull()
  })

  it("tag sem scoreTier (aviso/dinâmica) não aciona piso nenhum", () => {
    // "Escape the Original Male Lead!": a única tag era Sexual Harassment e a
    // regra antiga (por keyword) deu piso 7.0 = "sexo parcialmente mostrado".
    // Sexual Harassment é aviso, não ato retratado — hoje fica sem adult_score_tier.
    const b = computeAdultContentBounds({ tags: ci("Sexual Harassment"), genres: ["Fantasy", "Romance", "Shoujo"] })
    expect(b.floor).toBeNull()
    expect(b.ceiling).toBeNull()
  })

  it("Gore/Torture/Suicide (sem scoreTier) não são conteúdo sexual", () => {
    expect(computeAdultContentBounds({ tags: ci("Gore", "Torture", "Suicide/s") }).floor).toBeNull()
  })

  it("fato de ENREDO (sem scoreTier) não aciona o piso 9 — a cena pode ser cortada", () => {
    // A medição pegou isto: com "Sexually Active Protagonist" e "One-Night Stand" na
    // lista de atos, 204 obras subiriam pra 9, várias só por causa dessas duas. Elas
    // dizem que sexo ACONTECE na história, não que é MOSTRADO — por isso não recebem
    // adult_score_tier.
    for (const t of ["Sexually Active Protagonist", "One-Night Stand", "Sexual Teasing", "Virginity"]) {
      expect(computeAdultContentBounds({ tags: ci(t) }).floor, t).toBeNull()
    }
  })

  it("tag com scoreTier=label vai pro piso 7, não pro 9", () => {
    // "Adult"/"Sexual Content" dizem que há conteúdo adulto; não afirmam cena mostrada.
    for (const t of ["Adult", "Sexual Content", "Borderline H"]) {
      expect(computeAdultContentBounds({ tags: [labelTag(t)] }).floor, t).toBe(ADULT_LABEL_FLOOR)
    }
    expect(computeAdultContentBounds({ genres: ["Adult"] }).floor).toBe(ADULT_LABEL_FLOOR)
  })

  it("label + explicit na mesma obra → o ATO manda", () => {
    expect(computeAdultContentBounds({ tags: [labelTag("Adult"), explicitTag("Cunnilingus")] }).floor).toBe(
      EXPLICIT_FLOOR
    )
  })

  it("tag STRONG pro flag is_adult (adult_indicator_strong) sem scoreTier definido não gera piso", () => {
    // O próprio bug que motivou a migração 174: BDSM/Big Breasts/Pedophilia são
    // adult_indicator_strong=true (decidem works.is_adult sozinhas) mas, até
    // revisão humana, adult_score_tier fica NULL — dois eixos independentes.
    expect(computeAdultContentBounds({ tags: ci("BDSM", "Big Breasts", "Pedophilia") }).floor).toBeNull()
  })
})

describe("camada TETO: R15 based on R19 novel", () => {
  it("vira TETO 6, não piso", () => {
    const b = computeAdultContentBounds({ tags: [{ name: R15_FROM_R19_TAG, group: "content_indicator" }] })
    expect(b.ceiling).toBe(R15_FROM_R19_CEILING)
    expect(b.floor).toBeNull()
    expect(b.reasons.join(" ")).toMatch(/TETO/)
  })

  it("o teto derruba uma nota alta do modelo", () => {
    const b = computeAdultContentBounds({ tags: [{ name: R15_FROM_R19_TAG, group: "content_indicator" }] })
    expect(clampAdultContentScore(8.5, b)).toBe(6)
    expect(clampAdultContentScore(4, b)).toBe(4) // não é piso: nota baixa fica
  })

  it("com tag de ato explícito, o CONTEÚDO OBSERVADO vence o rótulo", () => {
    const b = computeAdultContentBounds({
      tags: [{ name: R15_FROM_R19_TAG, group: "content_indicator" }, explicitTag("Anal Sex")],
    })
    expect(b.floor).toBe(EXPLICIT_FLOOR)
    expect(b.ceiling).toBeNull()
    expect(b.conflict).toBe(true)
    expect(b.reasons.join(" ")).toMatch(/Prevalece o conteúdo observado/)
  })

  it("o R19 dentro do nome da tag R15 não vira piso de R19", () => {
    const b = computeAdultContentBounds({
      tags: [{ name: R15_FROM_R19_TAG, group: "content_indicator" }],
      synopsis: "[R19 disponível]",
    })
    expect(b.floor).toBeNull()
    expect(b.ceiling).toBe(R15_FROM_R19_CEILING)
  })

  it("o TETO vence o piso de RÓTULO — a tag específica desfaz o mal-entendido", () => {
    // "Under the Oak Tree" e "Mokrin" têm as duas tags: "R19" e "R15 but Based on a
    // R19 Novel". A específica existe justamente pra dizer que o R19 é do novel.
    // Antes desta precedência, as razões saíam contraditórias na MESMA justificativa:
    // "tem TETO 6.0, não piso" seguido de "adult_content ≥ 7.0".
    const b = computeAdultContentBounds({
      tags: [
        { name: R15_FROM_R19_TAG, group: "content_indicator" },
        labelTag("R19"),
        labelTag("Adult"),
      ],
    })
    expect(b.floor).toBeNull()
    expect(b.ceiling).toBe(R15_FROM_R19_CEILING)
    expect(b.reasons.join(" ")).toMatch(/NÃO elevam a nota/)
    expect(b.reasons.join(" ")).not.toMatch(/≥ 7,0|≥ 7\.0/)
  })
})

describe("camada MARCADOR: tags e classificações", () => {
  it("tag R19/R19 Version (scoreTier=label) → piso 7 (pode ser adulta por violência)", () => {
    expect(computeAdultContentBounds({ tags: [labelTag("R19")] }).floor).toBe(ADULT_LABEL_FLOOR)
    expect(computeAdultContentBounds({ tags: [labelTag("R19 Version")] }).floor).toBe(ADULT_LABEL_FLOOR)
  })

  it("suggestive → 5, erotica → 7", () => {
    expect(computeAdultContentBounds({ contentRatings: ["suggestive"] }).floor).toBe(5)
    expect(computeAdultContentBounds({ contentRatings: ["erotica"] }).floor).toBe(7)
  })

  it("fontes divergentes: vence a mais restritiva", () => {
    expect(computeAdultContentBounds({ contentRatings: ["suggestive", "erotica"] }).floor).toBe(7)
  })

  it("safe não gera piso", () => {
    expect(computeAdultContentBounds({ contentRatings: ["safe"] }).floor).toBeNull()
  })
})

describe("clampAdultContentScore", () => {
  it("respeita piso e teto e não mexe no que já está na faixa", () => {
    expect(clampAdultContentScore(3, { floor: 9, ceiling: null })).toBe(9)
    expect(clampAdultContentScore(9.5, { floor: 9, ceiling: null })).toBe(9.5)
    expect(clampAdultContentScore(7, { floor: null, ceiling: 6 })).toBe(6)
    expect(clampAdultContentScore(5, { floor: null, ceiling: 6 })).toBe(5)
    expect(clampAdultContentScore(5, { floor: null, ceiling: null })).toBe(5)
  })

  it("teto nunca fica abaixo do piso", () => {
    const b = computeAdultContentBounds({
      tags: [{ name: R15_FROM_R19_TAG, group: "content_indicator" }, explicitTag("Oral Sex")],
    })
    expect(clampAdultContentScore(2, b)).toBe(EXPLICIT_FLOOR)
  })
})

describe("obra sem sinal nenhum", () => {
  it("nenhum limite — o modelo pontua livre pela evidência", () => {
    const b = computeAdultContentBounds({ tags: ci(), genres: ["Romance"], synopsis: "Uma história." })
    expect(b).toMatchObject({ floor: null, ceiling: null, conflict: false, hasEditionMarkerOnly: false })
    expect(b.reasons).toEqual([])
  })
})
