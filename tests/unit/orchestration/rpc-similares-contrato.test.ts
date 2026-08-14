import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: quem lê `find_similar_works` só pode contar com as colunas que ela DEVOLVE.
 *
 * 🔴 O que isto pega, medido em 2026-08-14: `server/queries/deep-dive.ts` lia `r.user_score`
 * de um resultado que não traz esse campo desde a migration 151 (13/07/2026, que o removeu
 * porque era a nota do DONO servida a qualquer usuário). O efeito era mudo — `score` ficava
 * sempre `null`, `loved`/`avoided` saíam SEMPRE VAZIOS, e o prompt do Deep Dive imprimia
 * "(nenhuma obra similar suficientemente avaliada na biblioteca)" enquanto prometia o
 * contrário. Nada quebra: a coluna some do payload e o TypeScript não reclama de campo
 * ausente num `as SimilarRow[]`.
 *
 * ⚠️ Um `as X[]` sobre resposta de RPC é uma AFIRMAÇÃO sobre um contrato que mora em SQL, e
 * o compilador não a verifica. Este teste é a verificação — deriva as colunas do RETURNS
 * TABLE da migration vigente e confere contra o que cada consumidor declara.
 */

const ROOT = join(__dirname, "../../..")
const MIGRATIONS = join(ROOT, "supabase/migrations")

/** As colunas do `returns table(...)` da definição MAIS RECENTE da função. */
function colunasDaRpc(fn: string): string[] {
  const arquivos = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .reverse()

  for (const nome of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    // Só a definição REAL conta — comentários citam a função o tempo todo.
    const i = sql.toLowerCase().indexOf(`create function public.${fn}`)
    if (i < 0) continue
    const trecho = sql.slice(i)
    const m = trecho.match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i)
    if (!m) continue
    return m[1]
      .split(",")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean)
  }
  return []
}

/** Arquivos de `server/` que chamam a RPC. */
function consumidores(fn: string): string[] {
  const dir = join(ROOT, "server/queries")
  return readdirSync(dir)
    .filter((n) => n.endsWith(".ts"))
    .filter((n) => readFileSync(join(dir, n), "utf8").includes(`"${fn}"`))
    .map((n) => join("server/queries", n))
}

describe("contrato da RPC find_similar_works", () => {
  const colunas = colunasDaRpc("find_similar_works")

  it("a definição vigente é legível (senão o teste passa por vacuidade)", () => {
    expect(colunas.length).toBeGreaterThan(0)
    expect(colunas).toContain("id")
    expect(colunas).toContain("similarity")
  })

  it("🔴 NÃO devolve user_score — é a nota do DONO (migration 151)", () => {
    expect(colunas).not.toContain("user_score")
  })

  it("há pelo menos um consumidor", () => {
    expect(consumidores("find_similar_works").length).toBeGreaterThan(0)
  })

  it.each(consumidores("find_similar_works"))(
    "%s só declara campos que a RPC devolve",
    (arquivo) => {
      const src = readFileSync(join(ROOT, arquivo), "utf8")

      // A interface que tipa o resultado — o `as X[]` do consumidor.
      const m = src.match(/interface\s+SimilarRow\s*\{([\s\S]*?)\}/)
      if (!m) return // consumidor que não tipa a linha não tem o que conferir

      const declarados = [...m[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[?:]/gim)].map((x) => x[1])
      const forasteiros = declarados.filter((c) => !colunas.includes(c))

      expect(
        forasteiros,
        `${arquivo} declara ${forasteiros.join(", ")} — a RPC não devolve isso, então o campo ` +
          `chega undefined e some em silêncio. Leia do espelho per-user, como similar-works.ts.`,
      ).toEqual([])
    },
  )

  it("🔴 nenhum consumidor lê a nota direto do resultado da RPC", () => {
    // O caso concreto que passou despercebido por um mês. `personal.get(id).userScore` é a
    // forma certa; `r.user_score` sobre a linha da RPC é a errada.
    //
    // ⚠️ Só o CORPO da função que chama a RPC. A 1ª versão varria o arquivo inteiro e acusava
    // `fetchRecentActivity`, que lê `user_score` de `works_owner` — outra fonte, leitura
    // legítima. Varredura de arquivo inteiro confunde "está no arquivo" com "vem da RPC".
    for (const arquivo of consumidores("find_similar_works")) {
      const src = readFileSync(join(ROOT, arquivo), "utf8")
      const i = src.indexOf(`"find_similar_works"`)
      const resto = src.slice(i)
      const fim = resto.search(/\n(?:async )?function /)
      const corpo = (fim === -1 ? resto : resto.slice(0, fim))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
      expect(
        /\br\.user_score\b/.test(corpo),
        `${arquivo} lê user_score do resultado da RPC — ela não devolve mais isso`,
      ).toBe(false)
    }
  })
})

/**
 * O Deep Dive monta um prompt caro (extended thinking, 8–12k tokens) com dado PESSOAL:
 * pós-leitura, Nota Esperada, fit e atividade recente. Tudo isso tem de ser de QUEM OLHA.
 *
 * 🔴 Medido em 2026-08-14: `fetchWorkBundle` e `fetchRecentActivity` liam a view
 * `works_owner`, que é do DONO. Qualquer pessoa que rodasse Deep Dive levava para o prompt as
 * notas pós-leitura dele e as obras que ele tinha avaliado — impressas como `post_scores:` e
 * na seção de atividade recente. Nada acusava: a view responde, os campos existem, o tipo bate.
 */
describe("deep-dive não serve dado do DONO a quem olha", () => {
  const SRC = readFileSync(join(ROOT, "server/queries/deep-dive.ts"), "utf8")
  const semComentarios = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  it("🔴 não lê a view works_owner", () => {
    // A view carrega user_score, is_favorite, chapters_read e os 8 post_*_score do dono.
    expect(
      /\.from\(\s*["'`]works_owner["'`]/.test(semComentarios),
      "deep-dive.ts voltou a ler works_owner — ela é do DONO",
    ).toBe(false)
  })

  it("resolve a identidade por sessão, nunca pelo singleton", () => {
    // `getCurrentUserId()` cai no dono sem sessão: o filtro por user_id existiria sem filtrar.
    expect(semComentarios).toContain("getSessionUserId()")
  })

  it("passa `calculated_scores` pelo overlay per-user", () => {
    // A tabela não tem user_id — a linha crua é do dono.
    expect(semComentarios).toContain("getScoresReader()")
    expect(semComentarios).toMatch(/scoresReader\.overlay\(/)
  })
})
