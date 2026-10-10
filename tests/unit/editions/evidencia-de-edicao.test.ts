import { describe, expect, it } from "vitest"
import {
  decideAutoEditionState,
  extractMangaUpdatesEditionEvidence,
  parseEditionSections,
} from "@/lib/editions/edition-evidence"

/**
 * Os textos abaixo são trechos REAIS de descrições do MangaUpdates (`GET /v1/series/{id}`, coletadas
 * na auditoria de 2026-10-10), encurtados. Nenhum teste chama a API.
 *
 * Validação de ponta a ponta feita na mesma auditoria (206 respostas brutas): 139 das 140 `mixed`
 * saem `mixed` (a 140ª foi decidida por reviews, que o MU não mostra); nenhuma das 66 não-mixed sai
 * `mixed`; as `r18_only` saem `none`/`unknown` — nunca `r18_only` sozinho.
 */
const LUCIA = `Lucia is the princess…

**Original Webtoon:**
R15: [KakaoPage](https://page.kakao.com/content/52638309)
R19: [Daum](https://webtoon.kakao.com/content/x/2616), [KakaoPage](https://page.kakao.com/content/62674092)

**Official Translations (R15):**
English: [Lezhin (S1-S2)](https://www.lezhinus.com/en/comic/lucia), [Tappytoon](https://www.tappytoon.com/en/book/lucia)`

const WOLF = `…the woman he has now marked as his mate...

[Original Webtoon](https://series.naver.com/comic/detail.series?productNo=13373416)

**Official Translations:**
R19: [English](https://www.tappytoon.com/en/book/the-wolf-who-tempted-the-black-serpent-m)
R15: [English](https://www.tappytoon.com/en/book/the-wolf-who-tempted-the-black-serpent)`

const WICKED_HUSBAND = `…flee before his fire consumes her.

**Original Novel**: [R15](https://ridibooks.com/books/4869002005)
**R19**: [Chapters](https://ridibooks.com/books/4869002003), [Volumes](https://ridibooks.com/books/4869003512?)

[Original Webtoon](https://ridibooks.com/books/6039000001)

**Official Translations:**
[English](https://manta.net/en/series/a-wicked-husband?seriesId=3815), [French](https://www.webtoons.com/fr/x)`

const DISOBEY = `…she must never see his face.

[Original Webtoon](https://ridibooks.com/books/4801000001)

**Original Novel:**
[Chapters](https://ridibooks.com/books/2719000528), [Volumes](https://ridibooks.com/books/2719000739)

***Note:** This webtoon is not R19 like the novel, it was released as R15. Due to the webtoon being R15, it changes the story dramastically.*`

const HEROES_R19_ONLY = `…Its name? Semen Absorption.

**Original Webtoon:**
R19: [Ridibooks](https://ridibooks.com/books/3092046949)`

const LADY_CENSURA = `…How could she refuse her crush?

**Original Webtoon:**
[Ridibooks](https://ridibooks.com/books/2404009992), [Lezhin](https://www.lezhin.com/ko/comic/ladys_hobby)

**Official Translations:**
[English](https://tapas.io/series/x)`

describe("evidência de edição do MangaUpdates (texto CRU, antes da limpeza de sinopse)", () => {
  it("R15 E R19 do quadrinho ⇒ mixed, com as linhas de cada edição (sem URL)", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: LUCIA, categories: ["R15 but Based on a R19 Novel"] })
    expect(ev.verdict).toBe("mixed")
    expect(ev.basis).toBe("mangaupdates_description")
    expect(ev.normalLines.join(" ")).toContain("R15: KakaoPage")
    expect(ev.r18Lines.join(" ")).toContain("R19: Daum, KakaoPage")
    expect([...ev.normalLines, ...ev.r18Lines].join(" ")).not.toMatch(/https?:/)
  })

  it("o rótulo no PRÓPRIO cabeçalho ('Official Translations (R15):') conta como edição normal", () => {
    const secoes = parseEditionSections(LUCIA)
    const traducao = secoes.find((s) => s.kind === "translation")
    expect(traducao?.labels).toContain("15")
  })

  it("edição normal só na TRADUÇÃO continua mixed (idioma é informação separada)", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: WOLF, categories: [] })
    expect(ev.verdict).toBe("mixed")
    expect(ev.reason).toContain("Official Translations")
  })

  it("a categoria 'R19 with R15 Version' afirma as duas edições ⇒ mixed (pela categoria)", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: "Sinopse sem blocos.", categories: ["R18", "R19 with R15 Version"] })
    expect(ev.verdict).toBe("mixed")
    expect(ev.basis).toBe("mangaupdates_category")
  })

  it("R19 só no NOVEL não contamina o webtoon ⇒ single", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: WICKED_HUSBAND, categories: [] })
    expect(ev.verdict).toBe("single")
    expect(ev.reason).toContain("NOVEL")
    expect(ev.r18Lines).toEqual([])
    expect(ev.novelR18Lines.join(" ")).toContain("R19")
  })

  it("nota do MU dizendo que o webtoon é R15 ⇒ single", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: DISOBEY, categories: [] })
    expect(ev.verdict).toBe("single")
    expect(ev.reason).toContain("nota")
  })

  it("categoria 'R15 but Based on a R19 Novel' sem R19 no quadrinho ⇒ single", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: "Sinopse.", categories: ["R15 but Based on a R19 Novel"] })
    expect(ev.verdict).toBe("single")
  })

  it("R19 sem edição normal ⇒ no máximo unknown (r18_only nunca sai da ingestão)", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: HEROES_R19_ONLY, categories: ["Censorship"] })
    expect(ev.verdict).toBe("unknown")
  })

  it("só a categoria 'Official English R19 Version Available' ⇒ unknown, não mixed", () => {
    const ev = extractMangaUpdatesEditionEvidence({ description: "Sinopse.", categories: ["Official English R19 Version Available"] })
    expect(ev.verdict).toBe("unknown")
  })

  it("censura × sem censura NÃO é edição normal: só registra, não decide", () => {
    for (const cat of ["Uncensored Version Available", "Official English Uncensored", "English Company Added Censorship"]) {
      const ev = extractMangaUpdatesEditionEvidence({ description: LADY_CENSURA, categories: [cat, "Smut"] })
      expect(ev.verdict).toBe("none")
      expect(ev.categories.censorship).toEqual([cat])
    }
  })

  it("descrição vazia ou sem rótulo ⇒ none", () => {
    expect(extractMangaUpdatesEditionEvidence({ description: null, categories: null }).verdict).toBe("none")
    expect(extractMangaUpdatesEditionEvidence({ description: "Uma história comum.", categories: ["Romance"] }).verdict).toBe("none")
  })
})

describe("o que a ingestão automática pode fazer com o estado de edição", () => {
  it("sem estado: grava o veredito; 'none' não grava nada", () => {
    expect(decideAutoEditionState(null, "mixed")).toEqual({ action: "insert", state: "mixed" })
    expect(decideAutoEditionState(null, "single")).toEqual({ action: "insert", state: "single" })
    expect(decideAutoEditionState(null, "unknown")).toEqual({ action: "insert", state: "unknown" })
    expect(decideAutoEditionState(null, "none").action).toBe("keep")
  })

  it("nunca sobrescreve auditoria, curadoria nem o legado da mig 199", () => {
    for (const decidedBy of ["audit", "curator", "legacy"] as const) {
      for (const verdict of ["mixed", "single", "unknown"] as const) {
        expect(decideAutoEditionState({ state: "unknown", decidedBy }, verdict).action).toBe("keep")
        expect(decideAutoEditionState({ state: "r18_only", decidedBy }, verdict).action).toBe("keep")
      }
    }
  })

  it("um unknown automático (marcador/tag) sobe para mixed ou single com evidência; não oscila depois", () => {
    expect(decideAutoEditionState({ state: "unknown", decidedBy: "auto" }, "mixed")).toEqual({ action: "update", state: "mixed" })
    expect(decideAutoEditionState({ state: "unknown", decidedBy: "auto" }, "single")).toEqual({ action: "update", state: "single" })
    expect(decideAutoEditionState({ state: "unknown", decidedBy: "auto" }, "unknown").action).toBe("keep")
    expect(decideAutoEditionState({ state: "mixed", decidedBy: "auto" }, "single").action).toBe("keep")
    expect(decideAutoEditionState({ state: "single", decidedBy: "auto" }, "mixed").action).toBe("keep")
  })
})
