import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "../../..")

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8")
}

/**
 * Teste de ARQUITETURA, não de unidade.
 *
 * O indicador de tarefas já morreu uma vez sem que nada acusasse: quem o
 * desenhava no desktop era `components/tasks/sidebar-tasks.tsx`, renderizado
 * pela sidebar. A sidebar virou barra superior, o wrapper ficou com ZERO
 * referências, e as tarefas passaram a entrar no store sem ninguém desenhar.
 * Build passou, runtime passou, a suíte inteira passou — só o feedback sumiu.
 *
 * Não existe teste de unidade que pegue isso, porque o componente órfão continua
 * correto. O que pega é uma varredura no source afirmando que ele está MONTADO.
 */
describe("indicador de tarefas: montagem no chrome", () => {
  it("a barra superior monta o chip E a faixa de progresso", () => {
    const topNav = read("components/layout/top-nav.tsx")
    expect(topNav).toContain("<TasksChip />")
    expect(topNav).toContain("<TasksProgressBar />")
  })

  it("a faixa é filha do <header>, que é quem tem `sticky` (e portanto posiciona)", () => {
    const topNav = read("components/layout/top-nav.tsx")
    const header = topNav.slice(topNav.indexOf("<header"), topNav.lastIndexOf("</header>"))
    // Fora do header, o `absolute` da faixa resolveria contra outro ancestral e
    // ela apareceria no lugar errado — ou em lugar nenhum.
    expect(header).toContain("<TasksProgressBar />")
    expect(header).toMatch(/<header[^>]*sticky/)
  })

  it("o layout raiz monta o card flutuante do mobile", () => {
    expect(read("app/layout.tsx")).toContain("<TasksFab />")
  })

  it("nenhum componente de components/tasks/ está órfão", () => {
    const dir = resolve(ROOT, "components/tasks")
    const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"))

    const orphans: string[] = []
    for (const file of files) {
      const source = readFileSync(resolve(dir, file), "utf8")
      const exported = [...source.matchAll(/export function ([A-Z]\w+)/g)].map((m) => m[1])
      for (const name of exported) {
        // Conta referências no repo INTEIRO menos a própria declaração. `grep -l`
        // por arquivo: basta um consumidor fora do arquivo que declara.
        const hits = execSync(
          `grep -rl --include='*.tsx' --include='*.ts' -w '${name}' components app lib || true`,
          { cwd: ROOT, encoding: "utf8" },
        )
          .split("\n")
          .filter((p) => p && !p.endsWith(`components/tasks/${file}`))
        if (hits.length === 0) orphans.push(`${file} → ${name}`)
      }
    }

    expect(orphans, `componente(s) sem nenhum consumidor: ${orphans.join(", ")}`).toEqual([])
  })
})
