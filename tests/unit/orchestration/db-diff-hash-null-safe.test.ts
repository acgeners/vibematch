import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * `scripts/db-diff.mjs` compara LOCAL × NUVEM por hash de conteúdo. Em 2026-08-10 descobrimos
 * que ele estava CEGO desde que nasceu (PR #354), e nada acusava.
 *
 * A expressão era `col1::text || '|' || col2::text || …` embrulhada num `coalesce(…, '')`. Em
 * SQL, `NULL || qualquer_coisa = NULL` — então UMA coluna nula anulava a linha inteira, o
 * `coalesce` a transformava em `''`, e a linha virava `md5('')`: o mesmo valor pra qualquer
 * conteúdo. Como quase toda linha larga tem algum NULL, o hash da TABELA passava a depender
 * apenas da CONTAGEM de linhas.
 *
 * Medido: `works` com apenas 5 colunas dava **981 linhas → 223 hashes distintos** (758
 * colapsaram). Com as 36 colunas reais o script dizia "✓ idêntico" enquanto `works` divergia
 * de verdade — o `db:push-curation` acusou a divergência e o diff a desmentiu. Três tabelas
 * estavam sob falso "idêntico": `works`, `tags` e `formula_config`.
 *
 * Este teste lê o SOURCE de propósito: o script roda `main()` na importação (fala com psql e
 * com a Management API), então não há como exercitar a função por chamada. E o que regride
 * aqui não é o resultado de uma função — é a FORMA da SQL gerada.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "scripts/db-diff.mjs"), "utf8")

describe("db-diff: a expressão de linha tem que ser NULL-SAFE", () => {
  it("faz coalesce por COLUNA, nunca em volta da concatenação inteira", () => {
    // Todo `.map((c) => …)` que monta pedaço de SQL a partir de uma coluna precisa neutralizar
    // o NULL ali dentro. É o `coalesce` do lado de FORA que produzia o colapso.
    const mapeados = [...SRC.matchAll(/map\(\((?:c|x)\) => `([^`]*)`\)/g)].map((m) => m[1])
    const comColuna = mapeados.filter((corpo) => corpo.includes("::text"))

    expect(comColuna.length, "nenhum map de coluna encontrado — o script mudou de forma").toBeGreaterThan(0)
    for (const corpo of comColuna) {
      expect(corpo, `coluna concatenada sem coalesce próprio: ${corpo}`).toContain("coalesce(")
    }
  })

  it("não reintroduz a assinatura do colapso", () => {
    // `coalesce(<cadeia com ||>, '')` é exatamente o padrão que apagava a linha inteira.
    expect(SRC, "voltou o coalesce em volta da concatenação").not.toMatch(
      /coalesce\(\$\{[a-zA-Z]+\}, ''\)/,
    )
  })

  it("os dois consumidores partilham UMA expressão só", () => {
    // O hash da tabela e o detalhe por linha precisam concordar: se um colapsar e o outro não,
    // a varredura aponta uma tabela que o detalhe declara idêntica — e vice-versa. A 1ª versão
    // tinha a cadeia escrita DUAS vezes, que foi como as duas puderam divergir sem ninguém ver.
    expect(SRC).toMatch(/function rowExpr\(cols\)/)
    const usos = [...SRC.matchAll(/rowExpr\(/g)].length
    expect(usos, "esperava a definição + os dois consumidores").toBeGreaterThanOrEqual(3)
  })

  it("separa e preenche com caracteres de controle, não com '|' e '\\N'", () => {
    // Sentinela e separador precisam ser valores que o dado não contém. `'|'` aparece em texto
    // livre (sinopse, review) e `'\N'` é convenção do COPY: com eles, ('a|b', null) e
    // ('a', 'b') podem hashear igual — colisão posicional silenciosa.
    expect(SRC).toMatch(/coalesce\(t\."\$\{c\}"::text, chr\(1\)\)/)
    expect(SRC).toMatch(/join\(" \|\| chr\(2\) \|\| "\)/)
  })
})
