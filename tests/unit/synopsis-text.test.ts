import { describe, it, expect } from "vitest"
import {
  cleanSynopsisText,
  dedupeByMeaning,
  isSameSynopsis,
  synopsisDuplicateScore,
} from "@/lib/synopsis-text"
import { dedupeSynopsisEntries, dedupeWorkSynopses } from "@/lib/work-derived"

// Todos os textos deste arquivo são recortes REAIS de `work_synopses` (2026-07-24).
// Foi o banco que expôs os buracos; os testes ficam com ele como fonte da verdade.

describe("cleanSynopsisText — blocos de fonte", () => {
  it("remove 'Original Novel:' inline (formato do MangaUpdates, tudo numa linha só)", () => {
    // O `cleanHtml` do MangaUpdates colapsa todo \n em espaço, então o bloco chega
    // grudado no fim da prosa — a versão antiga não tinha `novel` na lista e deixava
    // "KakaoPage, Naver Series, Ridibooks" pendurado no fim da sinopse.
    const out = cleanSynopsisText(
      "Will they follow through with the original plans to end their arranged marriage? " +
        "Original Novel: KakaoPage, Naver Series, Ridibooks"
    )
    expect(out).toBe("Will they follow through with the original plans to end their arranged marriage?")
  })

  it("remove o bloco multi-linha do Comix junto com a cauda de plataformas", () => {
    const out = cleanSynopsisText(
      "“Young lady, have we perhaps met somewhere before?”\n\n" +
        "Original Novel: \nNaver Novel, Naver Series\nNaver Webtoon, Naver Series\nT.Chinese, Indonesian, Japanese"
    )
    expect(out).toBe("“Young lady, have we perhaps met somewhere before?”")
  })

  it("remove 'Official Translations' com lista de links markdown", () => {
    const out = cleanSynopsisText(
      "Can there be a happy ending for a relationship that was poisoned from the beginning?\n\n" +
        "**Official Translations:**  \n" +
        "[English](https://www.tappytoon.com/en/book/time-of-the-blind-beast), [Japanese](https://mechacomic.jp/books/216055)"
    )
    expect(out).toBe("Can there be a happy ending for a relationship that was poisoned from the beginning?")
  })

  it("NÃO come prosa que só menciona 'original novel' sem dois-pontos", () => {
    // O gatilho antigo (`[:\s]`) casava com o espaço depois de "novel". Com `novel`
    // na lista e aquele gatilho, esta frase perderia tudo daí pra frente.
    const text = "But this wasn't in the original novel, was it?! She had no idea what came next."
    expect(cleanSynopsisText(text)).toBe(text)
  })

  it("para o bloco na primeira linha de prosa", () => {
    const out = cleanSynopsisText("Original Novel: Ridibooks\nShe woke up on the island alone.")
    expect(out).toBe("She woke up on the island alone.")
  })
})

describe("cleanSynopsisText — o que NÃO pode mais acontecer", () => {
  it("preserva o último parágrafo curto (a regra que truncava saiu)", () => {
    // Esta é uma sinopse do AniList inteira: a regra `\n{2,}…[^\n]{0,80}$` apagava a
    // pergunta final — 67 caracteres de texto sumindo sem deixar rastro.
    const text =
      'I-Yeon wanted a quiet life as an arborist—but hidden upstairs is a comatose killer who once tried to murder her. When he wakes with no memory, she panics… and lies: "I\'m your wife."\n\n' +
      "Can she survive the man who doesn’t remember her—or what he did?"
    expect(cleanSynopsisText(text)).toContain("Can she survive the man who doesn’t remember her")
  })

  it("preserva o marcador R19 mesmo quando o bloco que o continha é apagado", () => {
    const out = cleanSynopsisText(
      "A romance on the edge.\n\n**Original Webtoon :**\nR19 : [Ridibooks](https://ridibooks.com/books/5858000001)"
    )
    expect(out).toContain("A romance on the edge.")
    expect(out).toMatch(/R19/)
  })
})

describe("cleanSynopsisText — markup", () => {
  it("desfaz link markdown, apaga URL crua e asteriscos", () => {
    expect(cleanSynopsisText("**Bold** e [KakaoPage](https://page.kakao.com/content/63968767) e https://x.com/y"))
      .toBe("Bold e KakaoPage e")
  })

  it("é idempotente — limpar de novo não muda nada", () => {
    const dirty =
      "Prosa de verdade aqui.\n\n**Original Novel:**\n[KakaoPage](https://page.kakao.com/content/1), [Ridibooks](https://ridibooks.com/books/2)"
    const once = cleanSynopsisText(dirty)
    expect(cleanSynopsisText(once)).toBe(once)
  })

  it("apaga rótulo órfão em negrito na PRIMEIRA passada", () => {
    // `**Links:**` só vira `Links:` depois do strip de asterisco. Com o strip por
    // último, o rótulo sobrevivia à 1ª limpeza e sumia na 2ª — o texto mudava a cada
    // save, sem nada ter mudado na fonte.
    const dirty = "Nesta vida, Ellisa vai encontrar outro caminho.\n\n**Links:**\nhttps://exemplo.com/obra"
    const once = cleanSynopsisText(dirty)
    expect(once).toBe("Nesta vida, Ellisa vai encontrar outro caminho.")
    expect(cleanSynopsisText(once)).toBe(once)
  })
})

describe("identidade — o que conta como a mesma sinopse", () => {
  const base =
    "What's a girl to do when a problematic fave ends up as the catch of the day? After a long " +
    "hospitalization in her past life, Yuri is thrilled to wake up on a mysterious island feeling fit and healthy."

  it("mesmo texto com bloco de fonte a mais = a MESMA sinopse", () => {
    // Exatamente o print: MangaUpdates e Comix lado a lado como dois itens.
    const comComix = `${base}\n\n**Original Novel:**\nR15 (Main Story): [KakaoPage](https://page.kakao.com/content/63968767)`
    expect(isSameSynopsis(base, comComix)).toBe(true)
  })

  it("traduções diferentes da mesma obra NÃO são a mesma sinopse", () => {
    const outraTraducao =
      "I have been living alone on a deserted island for two years. However, one day, a man was caught on my fishing rod."
    expect(isSameSynopsis(base, outraTraducao)).toBe(false)
    expect(synopsisDuplicateScore(base, outraTraducao)).toBeLessThan(0.92)
  })

  it("dedupeByMeaning preserva a ordem de entrada — quem chega primeiro vence", () => {
    const out = dedupeByMeaning(
      [
        { id: "salva", text: base },
        { id: "nova", text: `${base}\n\nOriginal Novel: Ridibooks` },
        { id: "outra", text: "Uma história completamente diferente sobre um cavaleiro e seu dragão de estimação." },
      ],
      (item) => item.text
    )
    expect(out.map((o) => o.id)).toEqual(["salva", "outra"])
  })
})

describe("dedupeSynopsisEntries — o gravador", () => {
  const prosa = "Yuri acorda numa ilha misteriosa e pesca um homem de cabelo prateado que ela reconhece do romance."

  it("limpa o texto que vai pro banco", () => {
    const out = dedupeSynopsisEntries([
      { source: "comix", text: `${prosa}\n\n**Original Novel:**\n[Ridibooks](https://ridibooks.com/books/1)`, isPrimary: true },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(prosa)
  })

  it("colapsa as quase-idênticas de fontes diferentes numa linha só", () => {
    const out = dedupeSynopsisEntries([
      { source: "mangaupdates", text: `${prosa} Original Novel: KakaoPage, Naver Series`, isPrimary: true },
      { source: "comix", text: `${prosa}\n\n**Original Novel:**\n[Ridibooks](https://ridibooks.com/books/1)`, isPrimary: false },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe("mangaupdates")
    expect(out[0].isPrimary).toBe(true)
  })

  it("a principal herda o posto quando ela é quem absorve — nunca fica sem principal", () => {
    const outra = "Uma história completamente diferente sobre um cavaleiro e seu dragão de estimação."
    const out = dedupeSynopsisEntries([
      { source: "kitsu", text: outra, isPrimary: false },
      { source: "mangaupdates", text: prosa, isPrimary: true },
      { source: "comix", text: `${prosa} Original Novel: Ridibooks`, isPrimary: false },
    ])
    expect(out).toHaveLength(2)
    expect(out.filter((s) => s.isPrimary)).toHaveLength(1)
    expect(out.find((s) => s.isPrimary)?.source).toBe("mangaupdates")
  })

  it("descarta a linha que a limpeza esvazia (era só bloco de fonte)", () => {
    const out = dedupeSynopsisEntries([
      { source: "manual", text: prosa, isPrimary: true },
      { source: "comix", text: "**Official Translations:**\n[English](https://webtoons.com/x)", isPrimary: false },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe("manual")
  })
})

describe("dedupeWorkSynopses — a leitura", () => {
  it("colapsa quase-idênticas mas NÃO reescreve o texto", () => {
    const suja = `Prosa preservada como está no banco. Original Novel: Ridibooks`
    const out = dedupeWorkSynopses([
      { text: suja, is_primary: true, position: 0 },
      { text: "Prosa preservada como está no banco.", is_primary: false, position: 1 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(suja)
  })
})
