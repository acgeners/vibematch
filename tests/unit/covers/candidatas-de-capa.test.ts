import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { coverCandidates, pickCoverUrls, pickPrimaryCover, MAX_COVER_CANDIDATES } from "@/lib/work-derived"
import { pickPrimaryCover as pickPrimaryCoverPelaOutraPorta } from "@/lib/covers"

/**
 * Capa morta é o defeito mais silencioso que esta base tem: o `<img>` que falha não
 * emite erro, não corta layout e não gera rolagem — `scrollWidth - clientWidth` fica
 * 0. Em 08/2026 o host inteiro da Comix caiu e 23 obras exibiram o traço "—" por 4
 * dias com a capa boa já carregada na memória do app.
 *
 * O `CoverImage` sempre soube cair pra próxima candidata; o que faltava era alguém
 * PASSAR as candidatas. Estas são as invariantes que mantêm isso ligado.
 */
describe("candidatas de capa", () => {
  const linhas = [
    { url: "c", is_primary: false, position: 2 },
    { url: "a", is_primary: true, position: 9 },
    { url: "b", is_primary: false, position: 1 },
    { url: "d", is_primary: false, position: 3 },
    { url: "b", is_primary: false, position: 4 }, // duplicata
  ]

  it("ordena por is_primary e depois position, deduplicando", () => {
    expect(pickCoverUrls(linhas)).toEqual(["a", "b", "c", "d"])
  })

  it("🔴 pickCoverUrls NÃO tem teto — quem procura capa viva precisa da lista inteira", () => {
    // Esta é a invariante que quase virou bug ao escrever o teto. `scripts/repick-dead-covers.ts`
    // consome `pickCoverUrls` para PROCURAR uma capa que responda 200. Com um corte em 3, uma
    // obra cuja 4ª capa está viva seria reportada como "sem saída" — e o script diria isso com
    // código de saída 0. Erro que produz resultado, que é a família cara desta base.
    const muitas = Array.from({ length: 12 }, (_, i) => ({ url: `u${i}`, is_primary: i === 0, position: i }))
    expect(pickCoverUrls(muitas)).toHaveLength(12)
    expect(pickCoverUrls(muitas).length).toBeGreaterThan(MAX_COVER_CANDIDATES)
  })

  it("coverCandidates recorta pickCoverUrls sem reordenar — é PREFIXO, não outra régua", () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ({ url: `u${i}`, is_primary: i === 0, position: i }))
    const todas = pickCoverUrls(muitas)
    const recortada = coverCandidates(muitas)
    expect(recortada).toHaveLength(MAX_COVER_CANDIDATES)
    // Prefixo exato: se um dia `coverCandidates` ordenar por conta própria, as duas
    // passariam a discordar sobre QUAL é a capa da obra, que é o defeito que o
    // `lib/covers` acabou de deixar de ter.
    expect(recortada).toEqual(todas.slice(0, MAX_COVER_CANDIDATES))
  })

  it("a primária é a mesma com e sem teto", () => {
    expect(coverCandidates(linhas)[0]).toBe(pickPrimaryCover(linhas))
  })

  it("🔴 lib/covers.pickPrimaryCover DERIVA do dono — não tem régua própria", () => {
    // Até 2026-08-20 ela era `covers.find(is_primary) ?? covers[0]`, SEM olhar `position`.
    // O caso abaixo é exatamente onde as duas divergiam: sem primária marcada, a régua
    // antiga devolvia a primeira do array (ordem arbitrária do PostgREST) e a do dono
    // devolve a de menor `position`. Não divergiam na prática (0 obras nessa condição, o
    // índice parcial `work_covers_one_primary` segura), mas a dívida era real.
    const semPrimaria = [
      { url: "chegou-antes", is_primary: false, position: 7 },
      { url: "menor-position", is_primary: false, position: 1 },
    ]
    expect(pickPrimaryCoverPelaOutraPorta(semPrimaria)).toBe("menor-position")
    expect(pickPrimaryCoverPelaOutraPorta(semPrimaria)).toBe(pickPrimaryCover(semPrimaria))
  })

  it("lista vazia / nula não estoura e não inventa capa", () => {
    for (const vazio of [null, undefined, []]) {
      expect(coverCandidates(vazio)).toEqual([])
      expect(pickPrimaryCover(vazio)).toBeNull()
    }
    expect(coverCandidates([{ url: null, is_primary: true, position: 0 }])).toEqual([])
  })
})

/**
 * O passivo, com a contagem no TÍTULO do caso — é assim que ela não cresce calada.
 *
 * `<CoverImage url={...}>` passa UMA candidata, e nesse formato o componente não tem
 * pra onde cair: o fallback existe e fica desligado. A docstring dele promete o
 * contrário, que é o pior estado (capacidade construída e desligada lê como coberta).
 */
describe("o passivo de <CoverImage url> (uma candidata só)", () => {
  const semFallback = (() => {
    const arquivos = execSync(`git ls-files 'components/**/*.tsx' 'app/**/*.tsx'`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
    const achados: Array<{ arquivo: string; linha: number; declarado: boolean }> = []
    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, "utf8")
      let i = 0
      while ((i = fonte.indexOf("<CoverImage", i)) !== -1) {
        // Parse BALANCEADO até fechar a tag. Uma janela de N caracteres erra quando a
        // prop é uma expressão longa, e metade delas é.
        let j = i + "<CoverImage".length
        let chaves = 0
        let fim = -1
        while (j < fonte.length) {
          const c = fonte[j]
          if (c === "{") chaves++
          else if (c === "}") chaves--
          else if (c === ">" && chaves === 0) {
            fim = j
            break
          }
          j++
        }
        if (fim === -1) {
          i += "<CoverImage".length
          continue
        }
        const corpo = fonte.slice(i, fim + 1)
        if (!/\burls=\{/.test(corpo) && /\burl=\{/.test(corpo)) {
          const linha = fonte.slice(0, i).split("\n").length
          // Válvula: uma URL só é legítima quando não HÁ candidatas (capa que a fonte
          // externa devolveu, demo hardcoded). Declare o motivo encostado na chamada.
          const acima = fonte.split("\n").slice(Math.max(0, linha - 4), linha).join("\n")
          achados.push({ arquivo, linha, declarado: /cover-url-unica:\s*\S+\s+\S+/.test(acima) })
        }
        i = fim
      }
    }
    return achados
  })()

  const naoDeclarados = semFallback.filter((x) => !x.declarado)

  it(`não cresce — hoje ${naoDeclarados.length} chamadas passam uma candidata só`, () => {
    // 🔴 O número é o TETO, não uma meta: ele desce a cada leva migrada e nunca sobe.
    // Um `<CoverImage url=>` novo reprova aqui, com arquivo e linha, em vez de nascer
    // com o fallback desligado como os 36 que já existiam.
    const TETO = 29
    const onde = naoDeclarados.map((x) => `${x.arquivo}:${x.linha}`).join("\n  ")
    expect(
      naoDeclarados.length,
      `passaram a existir ${naoDeclarados.length} chamadas sem fallback (teto ${TETO}). ` +
        `Use urls={coverCandidates(...)} ou declare "// cover-url-unica: <motivo>":\n  ${onde}`,
    ).toBeLessThanOrEqual(TETO)
  })

  it("as três telas de maior tráfego já passam candidatas", () => {
    // Guarda o que este PR entregou: sem isto, uma refatoração devolve `url=` a elas e o
    // teto acima continua satisfeito, porque ele só conta o total.
    const migradas = [
      "components/titles/work-table.tsx",
      "components/ranking/ranking-table.tsx",
      "components/titles/work-hover-preview.tsx",
      "components/ranking/bussola-plane.tsx",
      "components/ranking/surprise-me-button.tsx",
    ]
    for (const arquivo of migradas) {
      const nesta = naoDeclarados.filter((x) => x.arquivo === arquivo)
      expect(nesta.length, `${arquivo} voltou a passar uma candidata só`).toBe(0)
    }
  })
})
