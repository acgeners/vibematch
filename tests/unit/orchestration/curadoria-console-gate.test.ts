import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"

/**
 * Invariante arquitetural: TODA rota que aparece na sidebar da console `/curadoria`
 * tem que estar gateada — e o gate que vale é o do proxy.
 *
 * O erro que isto pega não quebra build nem runtime: alguém acrescenta uma entrada na
 * console (ou cria a rota `/admin/qualquer-coisa`), esquece o `CONSOLE_PREFIXES` do
 * `middleware.ts`, e a página é servida a qualquer visitante — com aparência de área
 * restrita, porque a sidebar da curadoria vem junto. Nada falha; só fica aberto.
 *
 * Por que o proxy é o gate que conta (e o layout não basta): o Next renderiza layout e
 * página em PARALELO, então um `notFound()` no layout chega DEPOIS de o stream ter
 * começado — medido em dev, `GET /settings` anônimo devolvia 200 com o HTML da página
 * protegida no corpo. O `notFound()` da shell é 2ª linha, e por isso também é exigido
 * aqui: as duas camadas juntas.
 */

const NAV = "components/curadoria/console-nav.tsx"
const MIDDLEWARE = "middleware.ts"
const SHELL = "components/curadoria/console-shell.tsx"

/** Os `href:` declarados no array ENTRIES da sidebar da console. */
function consoleHrefs(): string[] {
  const src = readFileSync(NAV, "utf8")
  const block = src.slice(src.indexOf("const ENTRIES"), src.indexOf("\n]", src.indexOf("const ENTRIES")))
  return [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]!)
}

/** Os prefixos que o proxy protege. */
function gatedPrefixes(): string[] {
  const src = readFileSync(MIDDLEWARE, "utf8")
  const line = src.match(/const CONSOLE_PREFIXES\s*=\s*\[([^\]]*)\]/)
  expect(line, "CONSOLE_PREFIXES não encontrado em middleware.ts").toBeTruthy()
  return [...line![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

describe("arquitetura: a console /curadoria é gateada no proxy", () => {
  it("toda rota da sidebar está coberta por um prefixo do middleware", () => {
    const prefixes = gatedPrefixes()
    const hrefs = consoleHrefs()

    expect(hrefs.length, "a sidebar da console ficou sem entradas — o parser quebrou?").toBeGreaterThan(0)

    const unguarded = hrefs.filter(
      (h) => !prefixes.some((p) => h === p || h.startsWith(`${p}/`)),
    )
    expect(
      unguarded,
      `rotas na console sem gate no middleware.ts (CONSOLE_PREFIXES): ${unguarded.join(", ")}`,
    ).toEqual([])
  })

  it("todo prefixo gateado tem um layout que monta a shell (2ª linha do gate)", () => {
    const missing: string[] = []
    for (const prefix of gatedPrefixes()) {
      const layout = `app${prefix}/layout.tsx`
      if (!existsSync(layout)) {
        missing.push(`${layout} (ausente)`)
        continue
      }
      if (!/CuradoriaConsole/.test(readFileSync(layout, "utf8"))) {
        missing.push(`${layout} (não renderiza CuradoriaConsole)`)
      }
    }
    expect(missing, `prefixos gateados sem a shell: ${missing.join(", ")}`).toEqual([])
  })

  it("a shell continua checando o papel — o proxy é fail-open no caso ambíguo", () => {
    const src = readFileSync(SHELL, "utf8")
    expect(src).toMatch(/isCurrentUserAdmin\(\)/)
    expect(src).toMatch(/notFound\(\)/)
  })
})
