import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "../../..")

function callSites(): string[] {
  const out = execSync(
    `grep -rl --include='*.tsx' 'useScopedGuard(' components || true`,
    { cwd: ROOT, encoding: "utf8" },
  )
  return out.split("\n").filter((p) => p && !p.endsWith("components/tasks/scoped-task.tsx"))
}

/**
 * Teste de ARQUITETURA da trava âmbar.
 *
 * A regra que ele guarda não é intuitiva e custou uma volta pra descobrir:
 * **a porta de saída depende de a ação morar num modal ou solta na página.**
 *
 * `Dialog`/`Sheet` do Radix são modais — o scrim já bloqueia clique fora, então
 * o link da barra nem é alcançável e a porta real é fechar o diálogo. Ligar
 * `guardNavigation` nesses casos cria um interceptador global de cliques que
 * nunca dispara: código morto com cara de proteção, e que passa a interferir em
 * qualquer refatoração futura que torne o diálogo não-modal.
 *
 * Só ação SOLTA numa página usa `guardNavigation`.
 */
/**
 * Lista FIXA das ações request-scoped conhecidas.
 *
 * Existe porque as outras asserções deste arquivo só olham quem JÁ chama
 * `useScopedGuard` — um arquivo que PERDE a trava simplesmente deixa de ser call
 * site e sai do radar, e todas elas passam. Foi o que aconteceu: as mudanças do
 * `work-compare-drawer` sumiram num `git stash` esquecido, a suíte inteira ficou
 * verde e só uma conferência manual pegou.
 *
 * Lista fixa não encontra ação nova que ninguém apontou (ver
 * [[project-testes-arquitetura-armadilhas]]) — mas é o único formato que pega
 * regressão no que já foi decidido. Ao ligar uma ação scoped nova, some aqui.
 */
const SCOPED_ACTIONS = [
  "components/titles/update-data-dialog.tsx",
  "components/titles/external-search.tsx",
  "components/titles/work-compare-drawer.tsx",
  "components/favorites/lists/suggest-groups-dialog.tsx",
  "components/settings/weight-suggestions-panel.tsx",
  "components/settings/post-reading-weight-suggestions-panel.tsx",
]

describe("useScopedGuard: onde cada trava pode ser usada", () => {
  it("há pelo menos um call site (senão o teste passa por vacuidade)", () => {
    expect(callSites().length).toBeGreaterThan(0)
  })

  it.each(SCOPED_ACTIONS)("%s tem faixa âmbar, trava e o diálogo renderizado", (file) => {
    const source = readFileSync(resolve(ROOT, file), "utf8")
    expect(source, "sem `useScopedGuard`").toContain("useScopedGuard({")
    expect(source, "sem `<ScopedTaskStrip`").toContain("<ScopedTaskStrip")
    // O hook devolve o diálogo, mas quem renderiza é o chamador — esquecer isso
    // deixa a trava existindo e invisível.
    expect(source, "`guardDialog` nunca renderizado").toContain("{guardDialog}")
  })

  it("nenhuma ação dentro de Dialog/Sheet liga `guardNavigation`", () => {
    const offenders: string[] = []
    for (const file of callSites()) {
      const source = readFileSync(resolve(ROOT, file), "utf8")
      const isModal = /<Dialog\b|<Sheet\b/.test(source)
      const guardsNav = /guardNavigation:\s*true/.test(source)
      if (isModal && guardsNav) offenders.push(file)
    }
    expect(
      offenders,
      `modal não precisa de guarda de navegação — o scrim já bloqueia: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  it("toda ação SOLTA na página liga `guardNavigation` (senão a saída fica aberta)", () => {
    const offenders: string[] = []
    for (const file of callSites()) {
      const source = readFileSync(resolve(ROOT, file), "utf8")
      const isModal = /<Dialog\b|<Sheet\b/.test(source)
      const guardsNav = /guardNavigation:\s*true/.test(source)
      if (!isModal && !guardsNav) offenders.push(file)
    }
    expect(
      offenders,
      `sem modal, a porta de saída É o link da barra: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  it("as ações request-scoped NÃO entram no store azul (`runTask`)", () => {
    // O store azul promete "pode navegar, te aviso ao terminar". Para uma ação
    // cujo resultado vive na tela isso é falso — e é exatamente a confusão que
    // a Fase 3 existe pra evitar.
    const offenders = callSites().filter((file) =>
      /\brunTask\s*\(/.test(readFileSync(resolve(ROOT, file), "utf8")),
    )
    expect(
      offenders,
      `mesma ação nos dois indicadores — azul diz "pode sair", âmbar diz "não saia": ${offenders.join(", ")}`,
    ).toEqual([])
  })
})
