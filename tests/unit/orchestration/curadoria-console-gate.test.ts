import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { DECISION_QUEUES } from "@/lib/curadoria/decision-queues"

/**
 * Invariante arquitetural: TODA rota que aparece na sidebar da console `/curation`
 * tem que estar gateada — e o gate que vale é o do proxy.
 *
 * O erro que isto pega não quebra build nem runtime: alguém acrescenta uma entrada na
 * console apontando pra uma rota FORA de `/curation/*`, esquece o `CONSOLE_PREFIXES` do
 * `middleware.ts`, e a página é servida a qualquer visitante — com aparência de área
 * restrita, porque a sidebar da curadoria vem junto. Nada falha; só fica aberto.
 *
 * ⚠️ Desde 2026-08-16 os cinco membros são `/curation/*` e o prefixo é UM só, o que
 * torna esse esquecimento improvável — mas não impossível: a `ENTRIES` aceita qualquer
 * `href`, e foi assim que `/admin/model-metrics` viveu fora do prefixo da console.
 *
 * Por que o proxy é o gate que conta (e o layout não basta): o Next renderiza layout e
 * página em PARALELO, então um `notFound()` no layout chega DEPOIS de o stream ter
 * começado — medido em dev, `GET /curation/settings` anônimo devolvia 200 com o HTML da página
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

/** Todo `app/**‍/layout.tsx` que monta a shell da console, em caminho relativo à raiz. */
function shellLayouts(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.name === "layout.tsx" && /CuradoriaConsole/.test(readFileSync(path, "utf8"))) {
        found.push(path)
      }
    }
  }
  walk("app")
  return found
}

/** Os prefixos que o proxy protege. */
function gatedPrefixes(): string[] {
  const src = readFileSync(MIDDLEWARE, "utf8")
  const line = src.match(/const CONSOLE_PREFIXES\s*=\s*\[([^\]]*)\]/)
  expect(line, "CONSOLE_PREFIXES não encontrado em middleware.ts").toBeTruthy()
  return [...line![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

describe("arquitetura: a console /curation é gateada no proxy", () => {
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

  /**
   * A sidebar mostra o badge de cada fila indexando por `href`. Se a rota de uma fila
   * mudar em `DECISION_QUEUES` e a `ENTRIES` da sidebar não acompanhar, a chave deixa
   * de casar: `undefined` vira zero pelo `?? 0`, e zero não desenha badge nenhum. A
   * pendência some da tela feita pra mostrá-la, sem erro e sem log.
   *
   * Só nesta direção: `/curation/settings` tem badge e NÃO é fila de decisão (é pendência de
   * configuração), então a sidebar legitimamente tem entradas fora da lista.
   */
  it("toda fila de decisão tem entrada correspondente na sidebar da console", () => {
    const hrefs = consoleHrefs()
    const missing = DECISION_QUEUES.filter((q) => !hrefs.includes(q.href)).map((q) => q.href)
    expect(
      missing,
      `fila de DECISION_QUEUES sem entrada na sidebar (badge não aparece): ${missing.join(", ")}`,
    ).toEqual([])
  })

  /**
   * Layout no App Router ANINHA. Um `layout.tsx` que monta a shell dentro de uma rota
   * cujo pai já a monta desenha a console DUAS VEZES — duas sidebars lado a lado.
   *
   * Aconteceu com `/curation/requests`: o layout próprio parecia necessário ("entra na
   * console"), mas `app/curation/layout.tsx` já cobre todo `/curation/*`. Nada falha
   * — nem build, nem gate, nem teste de rota; só a página fica errada, e só pra quem
   * abre aquela rota específica. Foi um humano olhando a tela que pegou.
   *
   * Varredura de arquivo é o método CERTO aqui (ao contrário do contador no gatilho,
   * que precisou de render): a pergunta é sobre a árvore de arquivos, e é exatamente
   * isso que o Next usa pra decidir o aninhamento.
   */
  it("a shell não é montada duas vezes na mesma rota", () => {
    const layouts = shellLayouts()
    expect(layouts.length, "nenhum layout monta a shell — o walk quebrou?").toBeGreaterThan(0)

    const nested = layouts.filter((l) =>
      layouts.some((parent) => parent !== l && l.startsWith(parent.replace(/layout\.tsx$/, ""))),
    )
    expect(
      nested,
      `layout aninhado sob outro que já monta a console (sidebar duplicada): ${nested.join(", ")}`,
    ).toEqual([])
  })

  it("a shell continua checando o papel — o proxy é fail-open no caso ambíguo", () => {
    const src = readFileSync(SHELL, "utf8")
    expect(src).toMatch(/isCurrentUserAdmin\(\)/)
    expect(src).toMatch(/notFound\(\)/)
  })
})
