import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

/**
 * `npx <comando>` só roda o que o PROJETO fixou.
 *
 * 🔴 Por que existe: até 2026-11-06 o `tsx` não estava nas dependências, e 35 npm scripts (entre
 * eles `recalc:scores:cloud`, que grava em produção) mais os cabeçalhos de ~90 scripts chamavam
 * `npx tsx --env-file=.env.local …`. Sem o pacote no projeto, o npx resolve `tsx@latest` no
 * registro na hora e roda essa versão com `SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY`
 * carregados. Uma versão publicada por uma conta sequestrada rodaria com acesso de escrita ao
 * banco inteiro, que não tem PITR. Nada acusava: o comando funciona do mesmo jeito.
 *
 * O npx prefere o binário do `node_modules` local, e o lockfile guarda a versão e o hash dele.
 * Logo, a régua é: todo comando chamado por `npx` sai de uma dependência DIRETA declarada. Uma
 * dependência transitiva (o `jiti`, que vem do Tailwind e do ESLint) também vai parar no
 * `node_modules/.bin`, mas some quando o pacote que a traz muda — então não conta.
 *
 * Os binários saem do LOCKFILE (`packages["node_modules/<dep>"].bin`), não do disco: num worktree
 * limpo o `node_modules` dos serviços nem existe, e o teste não pode depender disso.
 */

const RAIZ = join(import.meta.dirname, "../../..")

type Uso = { onde: string; pacote: string; comando: string }

type Lockfile = {
  packages: Record<string, { bin?: Record<string, string>; dependencies?: object; devDependencies?: object }>
}

/** Comandos fornecidos pelas dependências DIRETAS de um pacote, segundo o lockfile dele. */
function binariosDiretos(lock: Lockfile): Map<string, string> {
  const raiz = lock.packages[""] ?? {}
  const diretas = new Set(Object.keys({ ...raiz.dependencies, ...raiz.devDependencies }))
  const bins = new Map<string, string>()
  for (const [caminho, info] of Object.entries(lock.packages)) {
    const nome = caminho.replace(/^node_modules\//, "")
    if (!caminho.startsWith("node_modules/")) continue
    if (!diretas.has(nome) || !info.bin) continue
    for (const comando of Object.keys(info.bin)) bins.set(comando, nome)
  }
  return bins
}

/**
 * Cada `npx <comando>` de um texto. As opções do npx (`--no-install`, `--yes`) são puladas.
 * Um `cd services/<x>` antes, na MESMA linha, faz o comando ser resolvido no pacote daquele
 * serviço — é assim que os scripts mandam instalar o Chromium do sidecar.
 */
function usosDoNpx(onde: string, texto: string): Uso[] {
  const usos: Uso[] = []
  texto.split("\n").forEach((linha, i) => {
    for (const m of linha.matchAll(/\bnpx((?:\s+-[-\w]+(?:=\S+)?)*)\s+([@\w][\w@/.-]*)/g)) {
      const antes = linha.slice(0, m.index)
      const servico = [...antes.matchAll(/\bcd\s+(services\/[\w-]+)/g)].pop()?.[1]
      usos.push({ onde: `${onde}:${i + 1}`, pacote: servico ?? ".", comando: m[2] })
    }
  })
  return usos
}

/** O comando é um binário declarado? `tsx@4.23.15` também falha: versão na linha baixa sem lockfile. */
function semDono(usos: Uso[], binsPorPacote: (dir: string) => Map<string, string>): string[] {
  return usos
    .filter((u) => !binsPorPacote(u.pacote).has(u.comando))
    .map((u) => `${u.onde} → npx ${u.comando} (pacote ${u.pacote})`)
}

const cache = new Map<string, Map<string, string>>()
const binsDe = (dir: string) => {
  if (!cache.has(dir)) cache.set(dir, binariosDiretos(JSON.parse(readFileSync(join(RAIZ, dir, "package-lock.json"), "utf8"))))
  return cache.get(dir)!
}

/** Do GIT, não do disco: o que conta é o que o repositório contém. */
const rastreados = execSync("git ls-files scripts CLAUDE.md", { cwd: RAIZ, encoding: "utf8" })
  .split("\n")
  .filter((p) => /^(CLAUDE\.md|scripts\/.+\.(ts|mjs|js|sh))$/.test(p))

const npmScripts = Object.entries<string>(JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).scripts)
const usosDoPackageJson = npmScripts.flatMap(([nome, cmd]) => usosDoNpx(`package.json#${nome}`, cmd))
const usosDosArquivos = rastreados.flatMap((p) => usosDoNpx(p, readFileSync(join(RAIZ, p), "utf8")))

describe("npx só roda comando de dependência fixada no projeto", () => {
  it(`npm scripts: todo npx sai de dependência direta (hoje ${usosDoPackageJson.length} chamadas)`, () => {
    // Sem chamada nenhuma o teste passaria por vacuidade: a régua deixaria de olhar o que existe.
    expect(usosDoPackageJson.length).toBeGreaterThan(0)
    expect(semDono(usosDoPackageJson, binsDe)).toEqual([])
  })

  it(`cabeçalhos dos scripts e CLAUDE.md: idem (hoje ${usosDosArquivos.length} chamadas)`, () => {
    expect(usosDosArquivos.length).toBeGreaterThan(0)
    expect(semDono(usosDosArquivos, binsDe)).toEqual([])
  })

  it("o tsx é fixado em versão EXATA: um intervalo deixaria o próximo `npm install` trocá-lo", () => {
    const dev = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).devDependencies ?? {}
    expect(dev.tsx).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("binário de dependência TRANSITIVA não conta, e o node_modules aninhado também não", () => {
    // O caso real é o `jiti`: está no lockfile (vem do Tailwind e do ESLint) com `bin`, mas
    // ninguém o declarou — ele some quando quem o traz muda. O aninhado cai pela mesma régua: o
    // caminho dele ("outro/node_modules/tsx") nunca é o nome de uma dependência declarada.
    const lock: Lockfile = {
      packages: {
        "": { devDependencies: { tsx: "4.23.15" } },
        "node_modules/tsx": { bin: { tsx: "dist/cli.mjs" } },
        "node_modules/jiti": { bin: { jiti: "lib/jiti-cli.mjs" } },
        "node_modules/outro/node_modules/tsx": { bin: { "tsx-aninhado": "x" } },
      },
    }
    expect([...binariosDiretos(lock)]).toEqual([["tsx", "tsx"]])
  })

  it("a régua reconhece o que não foi declarado, versão na linha e o pacote do serviço", () => {
    const bins = (dir: string) =>
      dir === "." ? new Map([["tsx", "tsx"]]) : new Map([["playwright", "playwright"]])
    const usos = usosDoNpx(
      "sintético",
      [
        "npx --no-install tsx scripts/a.ts",
        "npx tsx@4.23.15 scripts/a.ts",
        "npx cowsay oi",
        "`cd services/comix-render && npm i` e `npx playwright install chromium`",
        "npx playwright install chromium",
      ].join("\n"),
    )
    expect(semDono(usos, bins)).toEqual([
      "sintético:2 → npx tsx@4.23.15 (pacote .)",
      "sintético:3 → npx cowsay (pacote .)",
      "sintético:5 → npx playwright (pacote .)",
    ])
  })
})
