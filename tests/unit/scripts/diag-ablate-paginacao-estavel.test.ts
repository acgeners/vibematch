import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Os dois scripts de ablação paginam `works` e cada página tem que vir ORDENADA por chave total.
 *
 * 🔴 `range()` sem `order` não é paginação estável: o Postgres não promete ordem entre páginas.
 * Medido na nuvem em 2026-09-21, 2.050 linhas lidas em 3 páginas deram 1.550 ÚNICAS — e de
 * forma não-determinística. Num script de ablação isso não quebra nada: ele MEDE sobre um
 * catálogo com obras repetidas e outras faltando, e imprime um número plausível.
 *
 * Teste de SOURCE porque os dois rodam `main()` na importação. Escopo deliberadamente fechado
 * nestes dois arquivos — a varredura geral de paginação é outra investigação.
 */

const ARQUIVOS = ["scripts/diag-ablate-blocos.ts", "scripts/diag-ablate-criterios.ts"]

/** Sem comentários: o bloco explica o defeito e citaria os padrões que procuramos. */
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

/** Cada `.range(` com o trecho da cadeia desde o `.from(` que a abre. */
function cadeiasComRange(codigo: string): string[] {
  const out: string[] = []
  const re = /\.range\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(codigo))) {
    const inicio = codigo.lastIndexOf(".from(", m.index)
    out.push(codigo.slice(inicio, m.index))
  }
  return out
}

describe.each(ARQUIVOS)("%s pagina works com ordenação total", (arquivo) => {
  const codigo = semComentarios(readFileSync(resolve(process.cwd(), arquivo), "utf8"))
  const cadeias = cadeiasComRange(codigo)

  it("tem paginação para conferir (contraprova de vacuidade)", () => {
    expect(cadeias.length).toBeGreaterThan(0)
  })

  it("toda cadeia com .range() ordena por `id` (a PK — chave total, sem empate)", () => {
    for (const cadeia of cadeias) {
      expect(cadeia, `range sem order: ${cadeia.trim()}`).toMatch(/\.order\(\s*["']id["']/)
    }
  })

  it("não voltou a confiar em .limit(N>1000), que o PostgREST corta em 1000", () => {
    expect(codigo).not.toMatch(/from\(\s*["']works["']\)[^;]*\.limit\(\s*\d{4,}/)
  })
})
