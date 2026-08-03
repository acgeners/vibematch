import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * O casamento da busca global casa por INÍCIO DE PALAVRA, não por substring solta.
 *
 * O caso que motivou isto foi medido na tela: buscar "cor" trazia a seção "Viés & atributos",
 * porque a descrição dela diz "Nenhum **sco**re é alterado" — s-cor-e contém "cor". Também
 * casava "correções", "percorre", "decoração". Quem digita "cor" quer "Cores das notas", e um
 * resultado que o usuário não consegue explicar é pior que nenhum resultado.
 *
 * O teste roda contra a implementação REAL, extraída do componente — reimplementá-la aqui
 * testaria a cópia, e a cópia é justamente o que não pode divergir.
 */

const SRC = join(process.cwd(), "components/search/global-search.tsx")

/** Extrai `fold` + `matchesTerm` do componente e avalia (o arquivo é "use client"/TSX). */
function loadMatcher(): (haystack: string, term: string) => boolean {
  const src = readFileSync(SRC, "utf8")
  const grab = (name: string) => {
    const start = src.indexOf(`function ${name}(`)
    expect(start, `${name} não encontrada em ${SRC}`).toBeGreaterThan(-1)
    const open = src.indexOf("{", start)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1)
    }
    throw new Error(`${name}: chaves não fecham`)
  }
  const js = (grab("fold") + "\n" + grab("matchesTerm"))
    .replace(/: string/g, "")
    .replace(/: boolean/g, "")
  return new Function(`${js}; return matchesTerm`)() as (h: string, t: string) => boolean
}

const matches = loadMatcher()

describe("busca global: casamento por início de palavra", () => {
  it('"cor" NÃO casa no MEIO de palavra — o caso que motivou a regra', () => {
    expect(matches("Nenhum score é alterado", "cor")).toBe(false) // s-cor-e
    expect(matches("Percorre obra a obra os 9 atributos", "cor")).toBe(false) // per-cor-re
    expect(matches("uma decoração qualquer", "cor")).toBe(false) // de-cor-ação
  })

  it("prefixo legítimo casa, mesmo quando não é o que se queria", () => {
    // "correções" COMEÇA com "cor" — é acerto de prefixo, e a regra é essa. Filtrar isto
    // exigiria stemming; o resíduo é aceitável e previsível, ao contrário de casar no meio.
    expect(matches("sugere correções nos critérios", "cor")).toBe(true)
  })

  it('"cor" casa no início de palavra', () => {
    expect(matches("Cores das notas", "cor")).toBe(true)
    expect(matches("Cores dos atributos", "cor")).toBe(true)
  })

  it("ignora acento nos dois lados", () => {
    expect(matches("Calibração das notas", "calibracao")).toBe(true)
    expect(matches("Sincronização de constantes", "sincronizacao")).toBe(true)
    expect(matches("Viés & atributos", "vies")).toBe(true)
  })

  it("acha as seções que o usuário procurou e não achava", () => {
    expect(matches("Comix", "comix")).toBe(true)
    expect(matches("Embeddings", "embedding")).toBe(true)
  })

  it("trata o + como parte da palavra (18+)", () => {
    expect(matches("Auditoria 18+", "18+")).toBe(true)
    expect(matches("Piso de nota 18+ (tags)", "18+")).toBe(true)
  })

  it("termo com espaço vira busca de frase", () => {
    expect(matches("Piso de nota 18+ (tags)", "nota 18")).toBe(true)
    expect(matches("Piso de nota 18+ (tags)", "18 nota")).toBe(false)
  })

  it("termo vazio casa com tudo (lista completa)", () => {
    expect(matches("qualquer coisa", "")).toBe(true)
  })
})
