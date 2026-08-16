import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "../../..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8")

const TOP_NAV = "components/layout/top-nav.tsx"
const MOBILE_NAV = "components/layout/mobile-nav.tsx"
const ACCOUNT_CHIP = "components/layout/account-chip.tsx"
const CURATION_MENU = "components/layout/curation-menu.tsx"

/**
 * Testes de ARQUITETURA da barra superior.
 *
 * Guardam três decisões cujo descumprimento **não quebra build nem runtime** — só
 * entrega uma barra pior, em silêncio:
 *
 * 1. destino que exige sessão não pode aparecer pro visitante;
 * 2. um destino mora num lugar só (a fila de recomendação já esteve em dois);
 * 3. item recolhido pra dentro de menu tem que manter o contador no gatilho.
 *
 * ⚠️ Lista FIXA de rotas per-user: isto não descobre rota nova que ninguém apontou
 * (ver [[project-testes-arquitetura-armadilhas]]). Ao criar destino de topo que
 * dependa de sessão, some aqui.
 */
const PER_USER_DESTINATIONS = ["/reading", "/favorites", "/ranking", "/recommendations"]

/** Extrai `{ href: "...", ..., requiresSignedIn: true }` de uma lista literal de nav. */
function navEntries(source: string): Array<{ href: string; guarded: boolean }> {
  return [...source.matchAll(/\{\s*href:\s*"([^"]+)"([^}]*)\}/g)].map((m) => ({
    href: m[1],
    guarded: /requiresSignedIn:\s*true/.test(m[2]),
  }))
}

describe("barra superior — a régua", () => {
  it("todo destino per-user do topo exige sessão", () => {
    const entries = navEntries(read(TOP_NAV))
    expect(entries.length).toBeGreaterThan(0)

    for (const route of PER_USER_DESTINATIONS) {
      const entry = entries.find((e) => e.href === route)
      if (!entry) continue // pode ter saído da barra; o que não pode é estar SEM gate
      expect(entry.guarded, `${route} está na barra sem requiresSignedIn`).toBe(true)
    }
  })

  it("topo e bottom-nav não discordam sobre quem precisa de sessão", () => {
    const top = navEntries(read(TOP_NAV))
    const mobile = navEntries(read(MOBILE_NAV))

    for (const t of top) {
      const m = mobile.find((e) => e.href === t.href)
      if (!m) continue
      expect(
        m.guarded,
        `${t.href} exige sessão no topo e é público na bottom-nav (ou o contrário)`,
      ).toBe(t.guarded)
    }
  })

  it("a fila de recomendação mora em UM lugar só do chrome", () => {
    const places = [TOP_NAV, ACCOUNT_CHIP, CURATION_MENU, MOBILE_NAV].filter((f) =>
      read(f).includes("/my-ai-scores"),
    )
    expect(places, "a fila voltou a aparecer em mais de um lugar da barra").toEqual([ACCOUNT_CHIP])
  })

  it("nenhum destino da barra fica atrás de um dropdown", () => {
    // "Minha lista ▾" e "Explorar ▾" enterravam os destinos nº 1 e nº 2 um clique abaixo;
    // o segundo abria um menu de um item só.
    expect(read(TOP_NAV)).not.toMatch(/DropdownMenu/)
  })

  /**
   * A quarta invariante — "o contador fica no GATILHO" — mora em
   * `tests/unit/ui/chrome-counters-on-trigger.test.tsx`, e não aqui, porque varredura de
   * source NÃO a pega: a versão textual deste teste procurava `recQueue > 0` no trecho do
   * gatilho e passava com o badge desligado, satisfeita pelo mesmo trecho no `title` do
   * botão. Texto no arquivo não distingue "condição certa" de "condição desligada".
   */
})
