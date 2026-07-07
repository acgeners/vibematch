import { describe, expect, it } from "vitest"
import { scoreMangagoCandidate, collapseCjkSpaces, hasDerivativeRisk } from "@/lib/external/mangago-match"
import type { MangagoCandidate } from "@/lib/external/mangago-match"
import fixture from "@/tests/fixtures/mangago/resolve-cases.json"

const C = fixture.candidates as Record<string, MangagoCandidate>

describe("collapseCjkSpaces", () => {
  it("junta caracteres CJK separados por espaço, preserva espaço latino", () => {
    expect(collapseCjkSpaces("呪 術 廻 戦")).toBe("呪術廻戦")
    expect(collapseCjkSpaces("나 혼 자 만 레 벨 업")).toBe("나혼자만레벨업")
    expect(collapseCjkSpaces("Solo Leveling")).toBe("Solo Leveling")
    // misto: colapsa só o trecho CJK
    expect(collapseCjkSpaces("Attack on Titan 進撃 の 巨人")).toBe("Attack on Titan 進撃の巨人")
  })
})

describe("scoreMangagoCandidate — casos documentados", () => {
  it("Solo Leveling: exato vence sequência (Ragnarok)", () => {
    const exact = scoreMangagoCandidate(["Solo Leveling"], C.solo_leveling)
    const seq = scoreMangagoCandidate(["Solo Leveling"], C.solo_leveling_ragnarok)
    expect(exact.score).toBe(1)
    expect(exact.reason).toBe("exact")
    expect(seq.score).toBeCloseTo(0.78, 2)
    expect(seq.isReverseSubstringRisk).toBe(false)
    expect(exact.score).toBeGreaterThan(seq.score)
  })

  it("One Piece vs One Piece Colored: ambos 1.0, mas title vence otherTitle", () => {
    const original = scoreMangagoCandidate(["One Piece"], C.one_piece)
    const colored = scoreMangagoCandidate(["One Piece"], C.one_piece_colored)
    expect(original.score).toBe(1)
    expect(original.matchedKind).toBe("title") // canônico casou pelo título principal
    expect(colored.score).toBe(1)
    expect(colored.matchedKind).toBe("otherTitle") // colorida só casa via alt "ONE PIECE"
  })

  it("Dr. Stone vs Stone: reverse-substring é marcado como risco", () => {
    const risk = scoreMangagoCandidate(["Dr. Stone"], C.stone)
    expect(risk.score).toBeCloseTo(0.9, 5)
    expect(risk.reason).toBe("reverse_substring_substantial")
    expect(risk.isReverseSubstringRisk).toBe(true)

    const real = scoreMangagoCandidate(["Dr. Stone"], C.dr_stone)
    expect(real.score).toBe(1) // "Dr . Stone" normaliza p/ "dr stone" → exato
    expect(real.isReverseSubstringRisk).toBe(false)
    expect(real.score).toBeGreaterThan(risk.score)
  })

  it("Kaguya-sama (apelido) < Kaguya-sama wa Kokurasetai (romaji completo)", () => {
    const nickname = scoreMangagoCandidate(["Kaguya-sama"], C.kaguya_main)
    const full = scoreMangagoCandidate(["Kaguya-sama wa Kokurasetai"], C.kaguya_main)
    expect(full.score).toBeGreaterThan(nickname.score) // romaji completo casa muito melhor
    expect(full.matchedKind).toBe("otherTitle") // casa a linha romaji em "Other Title"
    // Nota (para E5): mesmo o romaji completo fica < 0.72 aqui porque o Mangago
    // gruda o subtítulo "~Tensai-tachi~" na mesma linha — vira insumo do banding.
    expect(full.score).toBeLessThan(0.72)
  })

  it("呪術廻戦 (native) casa 呪 術 廻 戦 (espaçado) — CJK NÃO fica 0", () => {
    const m = scoreMangagoCandidate(["呪術廻戦"], C.jujutsu_kaisen)
    expect(m.score).toBe(1)
    expect(m.matchedKind).toBe("otherTitle")
  })

  it("나 혼자만 레벨업 casa a versão espaçada — CJK coreano NÃO fica 0", () => {
    const m = scoreMangagoCandidate(["나 혼자만 레벨업"], C.solo_leveling_ko_spaced)
    expect(m.score).toBe(1)
    expect(m.matchedKind).toBe("otherTitle")
  })
})

describe("scoreMangagoCandidate — invariantes", () => {
  it("title exato vence otherTitle no MESMO score (mesmo candidato)", () => {
    const both: MangagoCandidate = { title: "One Piece", otherTitles: ["One Piece"], slug: "one_piece" }
    expect(scoreMangagoCandidate(["One Piece"], both).matchedKind).toBe("title")
    // e mesmo se um otherTitle casar por um target diferente ANTES do title:
    const cand: MangagoCandidate = { title: "One Piece", otherTitles: ["ONE PIECE"] }
    const r = scoreMangagoCandidate(["ONE PIECE", "One Piece"], cand)
    expect(r.score).toBe(1)
    expect(r.matchedKind).toBe("title")
  })

  it("slug NÃO entra como fator de score", () => {
    const a = scoreMangagoCandidate(["One Piece"], { title: "One Piece", slug: "aaa" })
    const b = scoreMangagoCandidate(["One Piece"], { title: "One Piece", slug: "zzz_one_piece_zzz" })
    expect(a.score).toBe(b.score)
    // slug contém o alvo mas o título não → não deve pontuar
    const slugOnly = scoreMangagoCandidate(["One Piece"], { title: "Totally Unrelated", slug: "one_piece" })
    expect(slugOnly.score).toBeLessThan(0.72)
  })

  it("determinístico — duas chamadas idênticas retornam o mesmo objeto", () => {
    const args = ["Solo Leveling", "나 혼자만 레벨업"]
    expect(scoreMangagoCandidate(args, C.solo_leveling)).toEqual(scoreMangagoCandidate(args, C.solo_leveling))
  })

  it("entradas vazias → score 0, sem erro", () => {
    expect(scoreMangagoCandidate([], C.one_piece).score).toBe(0)
    expect(scoreMangagoCandidate(["One Piece"], { title: "" }).score).toBe(0)
    expect(scoreMangagoCandidate([""], { title: "One Piece" }).score).toBe(0)
  })
})

describe("hasDerivativeRisk — doujinshi/derivado (E10B.6)", () => {
  it("marca 'dj' como TOKEN em slug, title e otherTitle", () => {
    // caso exato observado na E10B.5 (Jujutsu Kaisen title-only → doujinshi)
    expect(hasDerivativeRisk({ title: "Mating Season – Jujutsu Kaisen dj", otherTitles: ["Jujutsu Kaisen dj"], slug: "mating_season_jujutsu_kaisen_dj" })).toBe(true)
    expect(hasDerivativeRisk({ title: "Jujutsu Kaisen DJ" })).toBe(true) // case-insensitive
    expect(hasDerivativeRisk({ title: "Mating Season (Jujutsu Kaisen dj)" })).toBe(true) // parênteses
    expect(hasDerivativeRisk({ title: "Some Fanwork [DJ]" })).toBe(true) // colchetes
    expect(hasDerivativeRisk({ title: "Some Fanwork - dj" })).toBe(true) // hífen
    expect(hasDerivativeRisk({ title: "Clean", slug: "something_dj" })).toBe(true) // só no slug
  })

  it("marca doujin/doujinshi/dōjinshi em qualquer romanização", () => {
    expect(hasDerivativeRisk({ title: "Foo Doujinshi" })).toBe(true)
    expect(hasDerivativeRisk({ title: "Foo doujin" })).toBe(true)
    expect(hasDerivativeRisk({ otherTitles: ["Foo (Dōjinshi)"] })).toBe(true) // macron ō
    expect(hasDerivativeRisk({ title: "Foo dōjin" })).toBe(true)
  })

  it("NÃO marca 'dj' dentro de outra palavra (substring)", () => {
    expect(hasDerivativeRisk({ title: "Adjust the Sails" })).toBe(false) // "adjust"
    expect(hasDerivativeRisk({ title: "Banjo Kingdom" })).toBe(false) // "banjo"
    expect(hasDerivativeRisk({ title: "Kingdom Hearts II", slug: "kingdom_hearts_ii" })).toBe(false)
  })

  it("obras canônicas legítimas NÃO são marcadas", () => {
    expect(hasDerivativeRisk({ title: "Solo Leveling", slug: "solo_leveling" })).toBe(false)
    expect(hasDerivativeRisk({ title: "Miss Not-So Sidekick", slug: "miss_not_so_sidekick" })).toBe(false)
    expect(hasDerivativeRisk({ title: "One Piece", otherTitles: ["ONE PIECE"], slug: "one_piece" })).toBe(false)
  })

  it("scoreMangagoCandidate expõe isDerivativeRisk (candidato-level)", () => {
    const dj = scoreMangagoCandidate(["Jujutsu Kaisen"], { title: "Mating Season – Jujutsu Kaisen dj", otherTitles: ["Jujutsu Kaisen dj"], slug: "mating_season_jujutsu_kaisen_dj" })
    expect(dj.isDerivativeRisk).toBe(true)
    expect(dj.score).toBeGreaterThanOrEqual(0.72) // casa por forward-substring (seria auto sem o guard)
    // canônicas mantêm isDerivativeRisk=false
    expect(scoreMangagoCandidate(["Solo Leveling"], C.solo_leveling).isDerivativeRisk).toBe(false)
    expect(scoreMangagoCandidate(["One Piece"], C.one_piece).isDerivativeRisk).toBe(false)
  })
})
