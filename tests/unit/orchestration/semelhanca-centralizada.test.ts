import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * "Parecida" tem UMA régua no app: o espaço CENTRALIZADO (embedding − média do catálogo).
 *
 * 🔴 A mig 187 achou o "hubness" em agosto e centralizou só /descobrir; a aba Recomendações e o
 * Deep Dive (`find_similar_works`) seguiram no cru por três meses. Medido em 2026-11-16: no cru,
 * uma obra aparecia em 145 listas de "parecidas" e 23% do catálogo em nenhuma; centralizado,
 * 50 e 4,3%. Duas funções medindo "parecida" em espaços diferentes respondem diferente à mesma
 * pergunta, sem erro nenhum. Este teste lê a definição VIGENTE de cada função.
 */

const MIGRATIONS = join(__dirname, "../../../supabase/migrations")

/** O corpo da definição MAIS RECENTE de `public.<fn>` (comentários citam a função o tempo todo). */
function corpoVigente(fn: string): { arquivo: string; corpo: string } {
  const arquivos = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8")
    const i = sql.toLowerCase().search(new RegExp(`create (or replace )?function public\\.${fn}\\s*\\(`))
    if (i < 0) continue
    const resto = sql.slice(i)
    const fim = resto.indexOf("$function$;")
    return { arquivo, corpo: fim > 0 ? resto.slice(0, fim) : resto }
  }
  throw new Error(`nenhuma migration define public.${fn}`)
}

describe("semelhança entre obras: uma régua só", () => {
  it.each(["find_similar_works", "find_similar_to_seeds", "pairwise_similarity"])(
    "%s compara no espaço centralizado",
    (fn) => {
      const { arquivo, corpo } = corpoVigente(fn)
      expect(corpo, `${arquivo}: sem a média do catálogo`).toMatch(/avg\(\s*embedding\s*\)/i)
      expect(corpo, `${arquivo}: o vetor não é subtraído da média`).toMatch(/embedding\s*-\s*\w+\.m\b/i)
    },
  )

  it("find_similar_works tira a arquivada ANTES do corte, não depois", () => {
    // Filtrar depois do LIMIT devolve K−1 obras quando uma arquivada está entre as K mais próximas.
    const { corpo } = corpoVigente("find_similar_works")
    const limit = corpo.search(/limit\s+match_limit/i)
    const arquivada = corpo.search(/is_archived\s*=\s*false/i)
    expect(limit).toBeGreaterThan(-1)
    expect(arquivada).toBeGreaterThan(-1)
    expect(arquivada, "o filtro de arquivada vem depois do LIMIT").toBeLessThan(limit)
  })
})
