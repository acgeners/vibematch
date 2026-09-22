import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Guarda o conserto de 2026-09-21 no seed de Fantasy/Nobility.
 *
 * 🔴 Teste de SOURCE porque o script roda `main()` na importação — importá-lo aqui dispararia
 * uma execução contra o banco. É o mesmo arranjo de `db-diff-hash-null-safe.test.ts`.
 *
 * O que ele casa é o FATO, não a grafia: que a chave de ordenação seja EXIGIDA (e não um
 * default, que é o que se esquece) e que a contagem venha do que o banco devolveu.
 */

const SRC = readFileSync(
  resolve(process.cwd(), "scripts/seed-fantasy-nobility-legado.ts"),
  "utf8",
)
/** Sem comentários: a docstring explica o defeito e citaria os padrões que procuramos. */
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("seed fantasy/nobility: paginação estável e contagem real", () => {
  it("pageAll RECUSA lista de ordenação vazia — a chave é exigida, não default", () => {
    expect(CODIGO).toMatch(/orderBy\.length\s*===\s*0[\s\S]{0,120}throw/)
  })

  it("pageAll aplica a ordenação em toda página", () => {
    // `range()` sem `order` não é paginação estável: medido 2050 lidas → 1550 únicas.
    expect(CODIGO).toMatch(/for\s*\(const\s+\w+\s+of\s+orderBy\)[\s\S]{0,80}\.order\(/)
  })

  it("nenhuma chamada de pageAll passa chave vazia", () => {
    const vazias = CODIGO.match(/pageAll[\s\S]{0,400}?\[\s*\]\s*,/g) ?? []
    expect(vazias).toEqual([])
  })

  it("as duas leituras declaram uma chave TOTAL para o conjunto que leem", () => {
    // um slug fixo ⇒ work_id basta; dois slugs ⇒ precisa do criterion_slug junto.
    expect(CODIGO).toMatch(/\[\s*"work_id"\s*\]/)
    expect(CODIGO).toMatch(/\[\s*"work_id"\s*,\s*"criterion_slug"\s*\]/)
  })

  it("a contagem de gravadas vem do que o banco DEVOLVEU, não do tamanho do lote", () => {
    // `ignoreDuplicates` descarta calado: lote.length afirmaria trabalho que não houve.
    expect(CODIGO).toMatch(/\.select\(/)
    expect(CODIGO).toMatch(/gravadas\s*\+=\s*data\?\.length/)
    expect(CODIGO).not.toMatch(/gravadas\s*\+=\s*lote\.length/)
  })
})
