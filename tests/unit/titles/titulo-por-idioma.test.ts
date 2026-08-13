import { describe, it, expect } from "vitest"
import { sortByTitleLanguage, titleLanguageRank } from "@/lib/titles/title-language"

/**
 * A ordem dos títulos alternativos na página da obra.
 *
 * Todos os títulos abaixo são REAIS do catálogo (medido em 13/08/2026: 10.072 títulos
 * alternativos, 63,6% em alfabeto latino). O que este arquivo guarda não é a acurácia de
 * um detector de idioma — é a ASSIMETRIA do erro: título inglês que escapa custa uma
 * posição na lista; romanização asiática promovida a inglês suja o topo, que é o único
 * lugar que a ordenação existe pra arrumar.
 */

describe("titleLanguageRank", () => {
  it("põe o inglês na frente por palavra funcional ou por morfologia", () => {
    expect(titleLanguageRank("The Villainess's Survival Plan")).toBe(0)
    expect(titleLanguageRank("I Tamed a Tyrant and Ran Away")).toBe(0)
    // Sem palavra funcional nenhuma: quem salva é o `-ing` e o genitivo `'s`.
    expect(titleLanguageRank("Adult Reading Club")).toBe(0)
    expect(titleLanguageRank("Lord Preston's Secret Private Tutor")).toBe(0)
  })

  it("NÃO promove romanização asiática a inglês", () => {
    // 🔴 A regressão que este caso guarda: classificar "ASCII sem marca de outra língua"
    // como inglês jogava estes três no topo da lista.
    expect(titleLanguageRank("Neukdae Sillang")).toBe(1)
    expect(titleLanguageRank("Manyeo, 30 Se")).toBe(1)
    expect(titleLanguageRank("Akuyaku Dorei no Goshujin-Sama ni Narimashita")).toBe(1)
  })

  it("reconhece as outras línguas latinas, com e sem acento", () => {
    expect(titleLanguageRank("Cómo domar al villano sin piedad")).toBe(1)
    expect(titleLanguageRank("Comment apprivoiser le vilain")).toBe(1)
    // Sem nenhum acento — quem decide é o artigo, e por isso `a`/`o`/`e` ficaram FORA da
    // lista inglesa: com eles, "A Herdeira Acidental" contava como inglês.
    expect(titleLanguageRank("A Herdeira Acidental")).toBe(1)
    expect(titleLanguageRank("Vamos Tomar Banho Juntos, Duque!")).toBe(1)
  })

  it("manda os outros sistemas de escrita pro fim", () => {
    expect(titleLanguageRank("악역의 주인님이 되었다")).toBe(2)
    expect(titleLanguageRank("悪役奴隷のご主人様になりました")).toBe(2)
    expect(titleLanguageRank("Как приручить злодея")).toBe(2)
  })

  it("título vazio não vira inglês por acidente", () => {
    expect(titleLanguageRank("   ")).toBe(1)
  })
})

describe("sortByTitleLanguage", () => {
  it("ordena inglês → latino → outro alfabeto, preservando a ordem dentro do grupo", () => {
    // Ordem de entrada = a que as fontes devolveram nesta obra.
    const entrada = [
      "悪役奴隷のご主人様になりました",
      "악역의 주인님이 되었다",
      "Comment apprivoiser le vilain",
      "Cómo domar al villano sin piedad",
      "I Became the Master of the Villain",
      "Akuyaku Dorei no Goshujin-Sama ni Narimashita",
      "How to Tame the Merciless Villain",
    ]
    expect(sortByTitleLanguage(entrada, (t) => t)).toEqual([
      "I Became the Master of the Villain",
      "How to Tame the Merciless Villain",
      "Comment apprivoiser le vilain",
      "Cómo domar al villano sin piedad",
      "Akuyaku Dorei no Goshujin-Sama ni Narimashita",
      "悪役奴隷のご主人様になりました",
      "악역의 주인님이 되었다",
    ])
  })

  it("não muda o array de entrada", () => {
    // A lista vem de `works.alternative_titles` e é reusada por outros consumidores.
    const entrada = ["악역의 주인님이 되었다", "The Villain"]
    const copia = [...entrada]
    sortByTitleLanguage(entrada, (t) => t)
    expect(entrada).toEqual(copia)
  })
})
