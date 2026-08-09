import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { STATUS_FILTER_PARAMS } from "@/lib/status-filter-toggle"

/**
 * Invariante arquitetural: quem lê os filtros de status da query string sai do dono
 * único (`lib/status-filter-toggle.ts`), nunca de `searchParams.get("pub_status")` à mão.
 *
 * 🔴 Por que é invariante e não estilo: a mesma query string é lida por consumidores
 * independentes — `getRanking` (via /ranking e /favorites) e
 * `parseFiltersFromSearchParams`, que alimenta o rerank e o diálogo de recomendação.
 * A inclusão (`pub_status`) e a exclusão (`pub_status_exclude`) são um PAR: quem ler só
 * a primeira metade continua compilando, continua devolvendo obras, e roda com um
 * filtro DIFERENTE do que a tela mostra — sem erro e sem log. Foi assim que os três
 * leitores acabaram com três parses copiados e defaults divergentes antes desta feature.
 *
 * O teste VARRE o source em vez de conferir uma lista fixa de arquivos: uma lista fixa
 * não acha o leitor novo que ninguém apontou — que é justamente o caso perigoso.
 */
const OWNER = "lib/status-filter-toggle.ts"
const ROOTS = ["app", "components", "lib", "server"]
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"])

/**
 * Arquivos que podem citar o literal sem passar pelo dono, e por quê:
 * - o próprio dono, que é quem define os nomes;
 * - o painel de filtros, que ESCREVE na URL via `updateParams` e precisa dos nomes
 *   para o badge "Todos" e para limpar o par (ele já importa o dono para a leitura);
 * - o link do painel de saúde do modelo, que é uma URL literal de CTA (`?pub_status=all`),
 *   não um leitor de filtro.
 */
const ALLOWED = new Set([
  OWNER,
  "components/ranking/ranking-filters.tsx",
  "components/settings/calibration/taste-model-health-panel.tsx",
  "components/titles/title-filters.tsx",
  "app/titles/page.tsx",
])

/**
 * O /titles roda em OUTRO motor (`server/queries/works.ts`), que não tem exclusão de
 * status — então ler só a metade positiva ali é coerente, não é meia-implementação.
 * A lista é explícita de propósito: no dia em que o /titles ganhar exclusão, tirar o
 * arquivo daqui é o que faz o teste voltar a cobri-lo.
 */
const WITHOUT_EXCLUSION = new Set(["components/titles/title-filters.tsx", "app/titles/page.tsx"])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** Documentação não é execução. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const SOURCES = ROOTS.flatMap((root) => walk(root))

describe("arquitetura: os filtros de status têm um dono só", () => {
  it("ninguém lê pub_status/per_status da URL por fora do dono", () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      if (ALLOWED.has(file)) continue
      const code = stripComments(readFileSync(file, "utf8"))
      for (const { include } of Object.values(STATUS_FILTER_PARAMS)) {
        // `.get("pub_status")` e variantes — a forma de LER a query string.
        if (new RegExp(`get\\(\\s*["'\`]${include}["'\`]`).test(code)) {
          offenders.push(`${file} → ${include}`)
        }
      }
    }
    expect(offenders, "use readStatusFilter() de lib/status-filter-toggle").toEqual([])
  })

  it("todo leitor da inclusão também lê a exclusão", () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      if (file === OWNER || WITHOUT_EXCLUSION.has(file)) continue
      const code = stripComments(readFileSync(file, "utf8"))
      for (const [kind, keys] of Object.entries(STATUS_FILTER_PARAMS)) {
        const readsInclude = new RegExp(`get\\(\\s*["'\`]${keys.include}["'\`]`).test(code)
        if (!readsInclude) continue
        const readsExclude =
          new RegExp(`["'\`]${keys.exclude}["'\`]`).test(code) || code.includes("readStatusFilter")
        if (!readsExclude) offenders.push(`${file} → lê ${keys.include}, ignora ${keys.exclude} (${kind})`)
      }
    }
    expect(offenders, "ler só metade do par filtra diferente do que a tela mostra").toEqual([])
  })

  it("os leitores que importam o dono não reimplementam o parse", () => {
    // `parseFiltersFromSearchParams` é o caso mais caro: ele alimenta rerank e
    // recomendação, e um parse próprio ali diverge em silêncio do que a página aplica.
    const code = stripComments(readFileSync("lib/ranking-filters-from-params.ts", "utf8"))
    expect(code).toContain("readStatusFilter")
    expect(code).toMatch(/publicationStatusExclude/)
    expect(code).toMatch(/personalStatusExclude/)
  })

  it("o motor de query aplica a exclusão das DUAS dimensões", () => {
    const code = stripComments(readFileSync("server/queries/ranking.ts", "utf8"))
    expect(code).toMatch(/publicationStatusExclude/)
    expect(code).toMatch(/personalStatusExclude/)
  })
})
