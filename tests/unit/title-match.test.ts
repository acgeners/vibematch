import { describe, it, expect } from "vitest"
import {
  foldTitle,
  titleTokens,
  nameMatchesQuery,
  workMatchesQuery,
  matchedAliasFor,
  matchTier,
  duplicateKeys,
} from "@/lib/title-match"

// Títulos reais do catálogo — os casos que motivaram este módulo.
const LADY = { title: "A Lady's Risqué Hobby", original_title: null, alternative_titles: null }
const FLIPS = { title: "The Villainess Flips the Script", original_title: null, alternative_titles: null }
const CHILDCARE = {
  title: "Childcare Diary With the Villain",
  original_title: null,
  alternative_titles: ["악당과의 육아일기", "Akdanggwaui yugailgi"],
}

describe("foldTitle", () => {
  it("tira acento, pontuação e caixa", () => {
    expect(foldTitle("A Lady's Risqué Hobby")).toBe("a lady s risque hobby")
    expect(foldTitle("Ero♥Märchen: Cinderella")).toBe("ero marchen cinderella")
    expect(foldTitle("Elizabeth (Ma Chérie)")).toBe("elizabeth ma cherie")
  })

  it("vira espaço, não some — senão o token seguinte não casa mais", () => {
    expect(foldTitle("Ero♥Märchen")).toBe("ero marchen")
    expect(foldTitle("Ero♥Märchen")).not.toBe("eromarchen")
  })

  it("aguenta null/vazio", () => {
    expect(foldTitle(null)).toBe("")
    expect(foldTitle("   ")).toBe("")
    expect(titleTokens(null)).toEqual([])
  })
})

describe("nameMatchesQuery", () => {
  it("casa prefixo de palavra", () => {
    expect(nameMatchesQuery("The Villainess Flips the Script", titleTokens("villain"))).toBe(true)
  })

  it("ignora a ordem das palavras", () => {
    expect(nameMatchesQuery("The Villainess Flips the Script", titleTokens("script villainess"))).toBe(true)
  })

  it("ignora acento", () => {
    expect(nameMatchesQuery("The Predator's Fiancée", titleTokens("fiancee"))).toBe(true)
    expect(nameMatchesQuery("Raising My Fiancé With Money", titleTokens("fiance"))).toBe(true)
  })

  it("casa por dentro da palavra via fallback compacto (o caso do apóstrofo)", () => {
    // "Lady's" tokeniza em lady + s; quem digita "Ladys" não casa prefixo nenhum.
    expect(nameMatchesQuery("A Lady's Risqué Hobby", titleTokens("ladys risque"))).toBe(true)
    expect(nameMatchesQuery("I'll Save This Damned Family", titleTokens("ill save"))).toBe(true)
  })

  it("NÃO casa substring no meio da palavra quando é curto demais", () => {
    // "ma" dentro de "drama" traria meio catálogo.
    expect(nameMatchesQuery("The Drama Club", titleTokens("ma"))).toBe(false)
    expect(nameMatchesQuery("The Drama Club", titleTokens("rama"))).toBe(true) // 4+ chars: passa
  })

  it("exige TODOS os tokens", () => {
    expect(nameMatchesQuery("The Villainess Flips the Script", titleTokens("villainess dragon"))).toBe(false)
  })

  it("busca vazia não casa nada", () => {
    expect(nameMatchesQuery("Qualquer Coisa", [])).toBe(false)
  })
})

describe("workMatchesQuery", () => {
  it("acha pelo título alternativo", () => {
    expect(workMatchesQuery(CHILDCARE, titleTokens("Akdanggwaui"))).toBe(true)
    expect(workMatchesQuery(CHILDCARE, titleTokens("악당과의"))).toBe(true)
  })

  it("acha pelo título principal", () => {
    expect(workMatchesQuery(LADY, titleTokens("risque hobby"))).toBe(true)
  })

  it("não inventa casamento", () => {
    expect(workMatchesQuery(LADY, titleTokens("dragon knight"))).toBe(false)
  })
})

describe("matchedAliasFor", () => {
  it("devolve o alias quando o casamento NÃO veio do título principal", () => {
    expect(matchedAliasFor(CHILDCARE, titleTokens("Akdanggwaui"))).toBe("Akdanggwaui yugailgi")
  })

  it("devolve null quando o título principal casou (não há o que explicar)", () => {
    expect(matchedAliasFor(CHILDCARE, titleTokens("childcare"))).toBeNull()
    expect(matchedAliasFor(FLIPS, titleTokens("villainess"))).toBeNull()
  })
})

describe("matchTier", () => {
  it("título idêntico ganha a faixa máxima", () => {
    expect(matchTier(FLIPS, "The Villainess Flips the Script")).toBe(3)
    expect(matchTier(FLIPS, "the villainess flips the script")).toBe(3)
  })

  it("começa-com vale mais que casa-tokens", () => {
    expect(matchTier(FLIPS, "The Villainess")).toBe(2)
    expect(matchTier(FLIPS, "script")).toBe(1)
  })

  it("zero quando não casa", () => {
    expect(matchTier(FLIPS, "dragon")).toBe(0)
    expect(matchTier(FLIPS, "")).toBe(0)
  })
})

describe("duplicateKeys", () => {
  it("normaliza título e original", () => {
    expect(duplicateKeys({ title: "A Lady's Risqué Hobby", original_title: "Risqué" })).toEqual([
      "a lady s risque hobby",
      "risque",
    ])
  })

  it("descarta aliases genéricos demais pra provar duplicata", () => {
    const keys = duplicateKeys({
      title: "Alguma Obra",
      alternative_titles: ["Official", "English", "Nome Real Alternativo"],
    })
    expect(keys).toContain("nome real alternativo")
    expect(keys).not.toContain("official")
    expect(keys).not.toContain("english")
  })

  it("deduplica", () => {
    expect(duplicateKeys({ title: "Mesma", original_title: "mesma" })).toEqual(["mesma"])
  })

  it("compara igualdade, não prefixo — não pode bloquear obra diferente", () => {
    const curta = duplicateKeys({ title: "Villain Duke" })
    const longa = duplicateKeys({ title: "Villain Duke's Precious One" })
    expect(curta.some((k) => longa.includes(k))).toBe(false)
  })

  it("descarta alias fragmento curto de um nome mais longo da própria obra", () => {
    // "Your Majesty" é a quebra na vírgula de "Your Majesty, Your Territory Is
    // Not Good" — não pode virar chave que casa obra de outro gênero.
    const keys = duplicateKeys({
      title: "Milady's Land's a Mess!",
      alternative_titles: ["Your Majesty", "Your Majesty, Your Territory Is Not Good"],
    })
    expect(keys).not.toContain("your majesty")
    expect(keys).toContain("your majesty your territory is not good")
  })

  it("mantém alias de 3+ palavras mesmo que também apareça em nome mais longo", () => {
    const keys = duplicateKeys({
      title: "My Unexpected Marriage (EMOTO Mashimesa)",
      alternative_titles: ["My Unexpected Marriage"],
    })
    expect(keys).toContain("my unexpected marriage")
  })

  it("nunca descarta título/original, ainda que sejam fragmento de um alias", () => {
    const keys = duplicateKeys({
      title: "Your Majesty",
      alternative_titles: ["Your Majesty, and the Long Tail"],
    })
    expect(keys).toContain("your majesty")
  })

  it("duas obras distintas deixam de colidir pelo fragmento honorífico", () => {
    const a = duplicateKeys({
      title: "Milady's Land's a Mess!",
      alternative_titles: ["Your Majesty", "Your Majesty, Your Territory Is Not Good"],
    })
    const b = duplicateKeys({
      title: "I'll Raise You Well in This Life, Your Majesty!",
      alternative_titles: ["Your Majesty!", "Your Majesty, I will raise you well in this life"],
    })
    expect(a.some((k) => b.includes(k))).toBe(false)
  })
})
