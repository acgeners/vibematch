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

// ---------------------------------------------------------------------------
// Título longo — a fonte inteira sumia em silêncio
// ---------------------------------------------------------------------------
// Reproduz o HTML REAL (medido 2026-07-24 contra a busca ao vivo) das DUAS âncoras
// que carregam o título e que crescem com ele: a da capa (título em alt= E title=,
// sobre uma URL de CDN longa) e a do <h2>, onde o Mangago embrulha CADA palavra
// casada da busca em <span class="hilight">. Com o teto de 400 chars no miolo do
// regex de âncora, as duas estouravam e só sobravam os links de capítulo — que o
// parser descarta. Resultado: [] , sem erro, e o Mangago não aparecia no diálogo.
const LONG_TITLE = "Shut up, Evil Dragon, I don't want to raise a child with you anymore"
const LONG_SLUG = "shut_up_evil_dragon_i_don_t_want_to_raise_a_child_with_you_anymore"

// Capa com URL de CDN do tamanho real (~200 chars) — é ela que empurra o miolo pro teto.
const LONG_COVER =
  "https://i0.mangapicgallery.com/r/coverlink/rROHYYKHa8H0kze7mzRDeI6d3aDYsVioY7tgIErRSAUz7kctKsWCX7nW15KW8DJAf6WiPFq0Y0dwJDKk-Acwetkf2_jDdBKmMKMTcwivwxfUxcxegG4IEPsb9i0i_iEXVNCJ2EDMfI0mCgz.jpeg?4"

/** Título com cada palavra embrulhada em <span class="hilight"> (como o Mangago devolve). */
const hilight = (title: string) =>
  title.split(" ").map((w) => `<span class="hilight">${w}</span>`).join(" ")

function realLi(slug: string, title: string, chapters: number[]) {
  const chapterLinks = chapters
    .map((n) => `<a class="chico" href="/read-manga/${slug}/uu/nml_chapter-${n}/pg-1/"><b>Ch.${n}</b></a>`)
    .join(", ")
  return `
  <li>
    <div class="box ">
      <div class="left">
        <a href="https://www.mangago.me/read-manga/${slug}/" class="thm-effect" title="${title}">
          <img src="${LONG_COVER}" alt="${title}" title="${title}" style="width:100px;height:142px">
        </a>
      </div>
      <div class="left">
        <div class="row-1"><span class="tit"><h2>
          <a style="background: url(&quot;https://pic1.mangapicgallery.com/images/manga_opened.png&quot;) no-repeat;padding-left:20px" href="https://www.mangago.me/read-manga/${slug}/">${hilight(title)}</a>
        </h2></span></div>
        <div class="row-3"><span class="blue">Latest Chapters: </span>${chapterLinks}</div>
      </div>
    </div>
  </li>`
}

describe("parseSearchResults — título longo (fonte sumia em silêncio)", () => {
  it("acha a obra mesmo com título longo nas DUAS âncoras (regressão do teto de 400)", () => {
    const html = page(realLi(LONG_SLUG, LONG_TITLE, [103, 102.5, 102, 101, 100, 99]))

    // Sanidade: o miolo da âncora de capa PRECISA passar de 400, senão o teste
    // não estaria exercendo o bug que existia.
    const inner = html.match(/<a\b[^>]*class="thm-effect"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""
    expect(inner.length).toBeGreaterThan(400)

    const results = parseSearchResults(html)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(`mangago:${LONG_SLUG}`)
    expect(results[0].title).toBe(LONG_TITLE)
  })

  it("títulos curtos continuam funcionando igual", () => {
    const results = parseSearchResults(page(realLi("solo_leveling", "Solo Leveling", [200])))
    expect(results.map((r) => r.title)).toEqual(["Solo Leveling"])
  })

  // Com o teto maior, uma âncora sem `</a>` passa a casar e "engole" a marcação
  // seguinte como miolo. O `title=` tem que continuar vencendo esse texto — senão
  // a obra órfã herdaria o título da obra de baixo.
  it("âncora sem </a> não rouba o título da obra seguinte", () => {
    const broken = `<html><body><ul class="pic_list">
      <li><a href="https://www.mangago.me/read-manga/orfa/" class="thm-effect" title="Órfã">
      ${realLi("boa", "Boa", [7])}</ul></body></html>`
    const results = parseSearchResults(broken)
    expect(results.find((r) => r.id === "mangago:orfa")?.title).toBe("Órfã")
  })
})

// ---------------------------------------------------------------------------
// Último capítulo — desempate da duplicata da MESMA fonte
// ---------------------------------------------------------------------------
// Caso real: o Mangago hospeda duas páginas da mesma obra coreana — o upload
// mantido (Ch.48) e um abandonado (Ch.10). As duas chegavam à tela com o mesmo
// título e match 100%, sem ano nem capítulo: impossível escolher.
describe("parseSearchResults — latestChapter", () => {
  it("lê o MAIOR capítulo do bloco (a lista não vem ordenada)", () => {
    const results = parseSearchResults(page(realLi("x", "X", [45, 48, 46, 47])))
    expect(results[0].latestChapter).toBe(48)
  })

  it("distingue as duas entradas duplicadas da mesma obra", () => {
    const results = parseSearchResults(
      page(
        realLi("i_caught_the_male_lead_on_a_deserted_island", "Reeling in the Male Lead", [48, 47, 46]),
        realLi("reeling_in_the_male_lead", "Reeling in the Male Lead", [10, 9, 8])
      )
    )
    expect(results.map((r) => [r.id, r.latestChapter])).toEqual([
      ["mangago:i_caught_the_male_lead_on_a_deserted_island", 48],
      ["mangago:reeling_in_the_male_lead", 10],
    ])
  })

  it("aceita capítulo decimal", () => {
    expect(parseSearchResults(page(realLi("x", "X", [102, 102.5]))).at(0)?.latestChapter).toBe(102.5)
  })

  it("sem lista de capítulos → undefined (não 0, que ordenaria errado)", () => {
    expect(parseSearchResults(page(li("x", "X"))).at(0)?.latestChapter).toBeUndefined()
  })
})
