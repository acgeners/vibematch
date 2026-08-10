import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * O DETALHE por linha do `scripts/db-diff.mjs` chaveava pela PRIMEIRA coluna do PK
 * (`chave.split(", ")[0]`). Em tabela de chave COMPOSTA isso funde num só balde todas as
 * linhas que compartilham essa coluna, e o `Map` guarda a ÚLTIMA — o detalhe passa a comparar
 * uma linha arbitrária por grupo e chama o resto de "valor diferente".
 *
 * Medido em 2026-08-10 em `work_genres` (PK `work_id, genre_id`): dizia "21 valor diferente"
 * onde o conjunto real de pares divergia em **6, com zero só na nuvem**. Errar para MAIS é o
 * lado caro: foi esse número que serviu de base para escolher um delete+insert.
 *
 * ⚠️ O hash da TABELA nunca teve esse problema — ele já ordenava pelo PK inteiro. Só o detalhe
 * mentia, e o detalhe é justamente o que se lê antes de decidir uma estratégia destrutiva.
 * É a mesma família do colapso por NULL (ver `db-diff-hash-null-safe.test.ts`): identidade de
 * linha errada, resultado plausível, nada acusando.
 *
 * Lê o SOURCE porque o script roda `main()` na importação (fala com psql e com a Management
 * API). Para o comportamento, a função é extraída do texto e EXECUTADA — regex sozinha prova
 * que a forma mudou, não que ela ficou certa.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "scripts/db-diff.mjs"), "utf8")

/**
 * ⚠️ Teste que varre source tem que varrer CÓDIGO, não prosa. A 1ª versão deste arquivo
 * reprovou o fix: o comentário que documenta o bug cita a expressão antiga literalmente, e o
 * regex casou com ela. Um teste assim pune quem explica o bug e passa verde para quem apaga a
 * explicação — exatamente o incentivo contrário ao que esta base quer.
 */
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** Recupera `keyExpr` do source e a torna chamável, sem executar o `main()` do script. */
function carregarKeyExpr(): (chave: string) => string {
  const m = SRC.match(/function keyExpr\(chave\) \{([\s\S]*?)\n\}/)
  if (!m) throw new Error("keyExpr não encontrada no source — o script mudou de forma")
  return new Function("chave", m[1]) as (chave: string) => string
}

describe("db-diff: o detalhe por linha usa o PK INTEIRO", () => {
  it("não volta a indexar a primeira coluna da chave", () => {
    // A assinatura exata do bug. Qualquer `[0]` aplicado ao split da chave devolve o detalhe cego.
    expect(CODIGO, "voltou a chavear só pela 1ª coluna do PK").not.toMatch(/chave\s*\.?\s*split\([^)]*\)\s*\[0\]/)
  })

  it("uma chave COMPOSTA cita todas as suas colunas", () => {
    const keyExpr = carregarKeyExpr()
    const sql = keyExpr(`t."work_id", t."genre_id"`)
    expect(sql, "a 2ª coluna do PK sumiu da expressão").toContain(`t."genre_id"`)
    expect(sql).toContain(`t."work_id"`)

    // 3 colunas (ai_eval_read_acks) também precisam entrar inteiras.
    const tres = keyExpr(`t."user_id", t."work_id", t."queue"`)
    for (const c of ["user_id", "work_id", "queue"]) expect(tres).toContain(`t."${c}"`)
  })

  it("chaves compostas distintas produzem expressões distintas", () => {
    // O teste que a versão antiga reprova: com `[0]`, (A,X) e (A,Y) geram a MESMA SQL.
    const keyExpr = carregarKeyExpr()
    expect(keyExpr(`t."work_id", t."genre_id"`)).not.toBe(keyExpr(`t."work_id", t."tag_id"`))
  })

  it("é NULL-safe e usa a mesma sentinela do rowExpr", () => {
    // Coluna anulável no PK não existe hoje, mas a expressão é a mesma família do colapso por
    // NULL — e `'|'` como separador colidiria com texto livre, igual lá.
    const keyExpr = carregarKeyExpr()
    const sql = keyExpr(`t."work_id", t."genre_id"`)
    expect(sql).toContain("coalesce(")
    expect(sql).toContain("chr(1)")
    expect(sql).toContain("chr(2)")
  })

  it("o consumidor do detalhe passa pela função, não monta a chave inline", () => {
    // Uma 2ª forma de montar a chave é como o hash da tabela e o detalhe voltariam a discordar.
    expect(SRC).toMatch(/select \$\{keyExpr\(d\.chave\)\} as k/)
  })
})
