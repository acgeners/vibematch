import { describe, expect, it } from "vitest"
import { parseSearchResults } from "@/lib/external/mangago"

// Bloco de resultado fiel à estrutura real da busca do Mangago (li > capa
// thm-effect + h2 + row-2 "Other Title"). otherTitle undefined = sem a linha.
function li(slug: string, title: string, otherTitle?: string, cover = `https://i.mangapicgallery.com/${slug}.jpg`) {
  const otherRow =
    otherTitle === undefined
      ? ""
      : `<div class="row-2 gray"><span class="blue">Other Title: </span>${otherTitle}</div>`
  return `
  <li>
    <div class="box ">
      <div class="left">
        <a href="https://www.mangago.me/read-manga/${slug}/" class="thm-effect" title="${title}">
          <img src="${cover}" alt="${title}">
        </a>
      </div>
      <div class="left">
        <div class="row-1"><span class="tit"><h2><a href="https://www.mangago.me/read-manga/${slug}/">${title}</a></h2></span></div>
        ${otherRow}
        <div class="row-5 gray"><span class="blue">Summary: </span>algo</div>
      </div>
    </div>
  </li>`
}
const page = (...blocks: string[]) => `<html><body><ul class="pic_list">${blocks.join("")}</ul></body></html>`
const first = (html: string) => parseSearchResults(html)[0]

describe("parseSearchResults — Other Title → alternativeTitles", () => {
  it("1. Other Title simples → preenche alternativeTitles", () => {
    const r = first(page(li("solo_leveling", "Solo Leveling", "Only I Level Up")))
    expect(r.alternativeTitles).toEqual(["Only I Level Up"])
  })

  it("2. vários aliases separados por ; → array múltiplo", () => {
    const r = first(page(li("x", "X", "Alias A ; Alias B ; Alias C")))
    expect(r.alternativeTitles).toEqual(["Alias A", "Alias B", "Alias C"])
  })

  it("aceita ; full-width (；)", () => {
    const r = first(page(li("x", "X", "エイリアス；別名")))
    expect(r.alternativeTitles).toEqual(["エイリアス", "別名"])
  })

  it("3. sem Other Title → alternativeTitles undefined", () => {
    const r = first(page(li("x", "X")))
    expect(r.alternativeTitles).toBeUndefined()
  })

  it("4. CJK/Hangul/kana preservados", () => {
    const r = first(page(li("solo_leveling", "Solo Leveling", "나 혼자만 레벨업; 俺だけレベルアップな件")))
    expect(r.alternativeTitles).toEqual(["나 혼자만 레벨업", "俺だけレベルアップな件"])
  })

  it("5. espaços extras → trim correto", () => {
    const r = first(page(li("x", "X", "   Alias One   ;   Alias Two   ")))
    expect(r.alternativeTitles).toEqual(["Alias One", "Alias Two"])
  })

  it("6. não duplica o título principal (case-insensitive)", () => {
    const r = first(page(li("one_piece", "One Piece", "ONE PIECE ; ワンピース")))
    expect(r.alternativeTitles).toEqual(["ワンピース"])
  })

  it("dedup interno de aliases repetidos", () => {
    const r = first(page(li("x", "X", "Repetido ; repetido ; Único")))
    expect(r.alternativeTitles).toEqual(["Repetido", "Único"])
  })

  it("tira as tags <span class=hilight> do highlight de busca", () => {
    const r = first(
      page(li("x", "X", `<span class="hilight">Solo</span> Leveling: Arise ; Hunter Origin`))
    )
    expect(r.alternativeTitles).toEqual(["Solo Leveling: Arise", "Hunter Origin"])
  })
})

describe("parseSearchResults — compatibilidade (não quebra slug/title/cover)", () => {
  it("7. continua extraindo id(slug)/title/cover como antes", () => {
    const r = first(page(li("solo_leveling", "Solo Leveling", "Only I Level Up", "https://cdn/x.jpg")))
    expect(r.id).toBe("mangago:solo_leveling")
    expect(r.source).toBe("mangago")
    expect(r.title).toBe("Solo Leveling")
    expect(r.coverUrl).toBe("https://cdn/x.jpg")
  })

  it("8. resultado é ExternalSearchResult válido (contrato do searchAllSources)", () => {
    const results = parseSearchResults(page(li("a", "A", "alias"), li("b", "B")))
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.id.startsWith("mangago:")).toBe(true)
      expect(r.source).toBe("mangago")
      expect(typeof r.title).toBe("string")
      // alternativeTitles é opcional: array ou undefined (nunca outro tipo)
      expect(r.alternativeTitles === undefined || Array.isArray(r.alternativeTitles)).toBe(true)
    }
    expect(results[1].alternativeTitles).toBeUndefined() // 'b' sem Other Title
  })

  it("associa o Other Title ao slug CERTO quando há vários resultados", () => {
    const results = parseSearchResults(
      page(li("first", "First", "Alias First"), li("second", "Second", "Alias Second"))
    )
    expect(results.find((r) => r.id === "mangago:first")?.alternativeTitles).toEqual(["Alias First"])
    expect(results.find((r) => r.id === "mangago:second")?.alternativeTitles).toEqual(["Alias Second"])
  })
})
