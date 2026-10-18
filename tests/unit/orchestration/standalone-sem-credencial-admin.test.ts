import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CREDENCIAIS_SO_DE_SCRIPT, ambienteDoServidor, carregarEnvLocal, decidirInicioLocal } from "@/scripts/lib/standalone-env.mjs"

/**
 * `npm start` NÃO repassa credencial administrativa ao `next-server` (2026-10-16).
 *
 * O `SUPABASE_ACCESS_TOKEN` (só de scripts) apareceu num transcript porque o `start-standalone.mjs`
 * injetava o `.env.local` inteiro no servidor, e o `next-server`, ao reescrever o título do processo,
 * deixa a 1ª string do ambiente visível no `pgrep -fl`. Os valores aqui são FICTÍCIOS.
 */

const RAIZ = path.resolve(__dirname, "../../..")
const ENV_LOCAL_FICTICIO = [
  "SUPABASE_ACCESS_TOKEN=token-ficticio",
  "ANTHROPIC_API_KEY=chave-ficticia",
  "# COMENTADA=nao-entra",
  "NEXT_PUBLIC_SUPABASE_URL=https://ficticio.supabase.co",
  "SUPABASE_SERVICE_ROLE_KEY=service-ficticia",
  "SUPABASE_DB_PASSWORD=senha-ficticia",
  "",
].join("\n")

const temporarios: string[] = []
function raizTemporaria(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "standalone-env-"))
  temporarios.push(dir)
  writeFileSync(path.join(dir, ".env.local"), ENV_LOCAL_FICTICIO)
  return dir
}
afterEach(() => {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("o ambiente do servidor", () => {
  it("o loader lê o .env.local inteiro, credencial administrativa inclusive (os scripts dependem dele)", () => {
    const env = carregarEnvLocal(raizTemporaria())
    expect(env.SUPABASE_ACCESS_TOKEN).toBe("token-ficticio")
    expect(env.SUPABASE_DB_PASSWORD).toBe("senha-ficticia")
    expect(env.ANTHROPIC_API_KEY).toBe("chave-ficticia")
    expect(env).not.toHaveProperty("COMENTADA")
  })

  it("as credenciais administrativas não entram — nem do .env.local, nem do shell", () => {
    const env = ambienteDoServidor({
      envLocal: carregarEnvLocal(raizTemporaria()),
      processEnv: { SUPABASE_ACCESS_TOKEN: "do-shell", SUPABASE_DB_PASSWORD: "do-shell", PATH: "/usr/bin" },
      porta: "3000",
    })
    for (const chave of CREDENCIAIS_SO_DE_SCRIPT) expect(env).not.toHaveProperty(chave)
    expect(CREDENCIAIS_SO_DE_SCRIPT).toEqual(expect.arrayContaining(["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]))
  })

  it("o que o runtime usa continua lá, e o shell vence o .env.local como antes", () => {
    const env = ambienteDoServidor({
      envLocal: carregarEnvLocal(raizTemporaria()),
      processEnv: { ANTHROPIC_API_KEY: "do-shell", PATH: "/usr/bin", PORT: "4000" },
      porta: "4000",
    })
    expect(env).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "https://ficticio.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-ficticia",
      ANTHROPIC_API_KEY: "do-shell",
      PATH: "/usr/bin",
      PORT: "4000",
    })
  })

  it("a 1ª chave do ambiente — a que o título do next-server expõe — é PORT, não um segredo", () => {
    const env = ambienteDoServidor({
      envLocal: carregarEnvLocal(raizTemporaria()),
      processEnv: { PATH: "/usr/bin", PORT: "3000" },
      porta: "3000",
    })
    expect(Object.keys(env)[0]).toBe("PORT")
    expect(env.PORT).toBe("3000")
  })
})

describe("o lançador real (scripts/start-standalone.mjs), com um server.js falso", () => {
  it("o processo filho recebe o ambiente sem as credenciais, e PORT na frente", () => {
    const raiz = raizTemporaria()
    const standalone = path.join(raiz, ".next", "standalone")
    mkdirSync(standalone, { recursive: true })
    // O falso grava só os NOMES das variáveis que recebeu, na ordem em que vieram, e sai.
    writeFileSync(
      path.join(standalone, "server.js"),
      'require("fs").writeFileSync(process.env.SAIDA_SONDA, JSON.stringify(Object.keys(process.env)))\n',
    )
    const saida = path.join(raiz, "chaves.json")
    const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts/start-standalone.mjs")], {
      cwd: raiz,
      // Banco LOCAL (o shell vence o .env.local): a pasta temporária não é checkout git, e contra a nuvem
      // o lançador exige checkout canônico — ver o bloco da guarda abaixo.
      env: { PATH: process.env.PATH ?? "", SAIDA_SONDA: saida, SUPABASE_DB_PASSWORD: "do-shell", PORT: "3197", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(r.status).toBe(0)
    const chaves = JSON.parse(readFileSync(saida, "utf8")) as string[]
    for (const chave of CREDENCIAIS_SO_DE_SCRIPT) expect(chaves).not.toContain(chave)
    expect(chaves).toEqual(expect.arrayContaining(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]))
    expect(chaves[0]).toBe("PORT")
  })
})

/**
 * 🔴 O lançador local só sobe contra a NUVEM a partir de checkout CANÔNICO (rastreado limpo + HEAD na
 * ponta da ref local `origin/main`) — a régua das chamadas pagas e do recálculo, pelo MESMO predicado
 * (`lib/ai/git-probe.mjs`). Motivo: o `npm start` é a curadoria local, e salvar "Versões da obra…"
 * reconcilia a inferência estrutural na hora, por um caminho fora da guarda do recálculo.
 */
describe("o lançador só sobe contra a nuvem a partir do checkout canônico", () => {
  const NUVEM = "https://ficticio.supabase.co"
  const LOCAL = "http://127.0.0.1:54321"
  const naoSonda = () => {
    throw new Error("não devia olhar o git")
  }

  it("decisão: Fly e banco local passam SEM olhar git; nuvem exige o predicado canônico", () => {
    expect(decidirInicioLocal({ url: NUVEM, onFly: true, sondar: naoSonda })).toEqual({ permitido: true, base: "fly" })
    expect(decidirInicioLocal({ url: LOCAL, onFly: false, sondar: naoSonda })).toEqual({ permitido: true, base: "banco_local" })
    const sonda = (extra: Record<string, unknown>) => () => ({ ok: true, sha: "a".repeat(40), branch: "main", dirtyTracked: false, inOriginMain: true, atOriginMain: true, ...extra }) as never
    expect(decidirInicioLocal({ url: NUVEM, onFly: false, sondar: sonda({}) })).toEqual({ permitido: true, base: "canonico" })
    expect(decidirInicioLocal({ url: NUVEM, onFly: false, sondar: sonda({ dirtyTracked: true }) })).toMatchObject({ permitido: false, motivo: /rastreados modificados/ })
    expect(decidirInicioLocal({ url: NUVEM, onFly: false, sondar: sonda({ atOriginMain: false }) })).toMatchObject({ permitido: false, motivo: /não é a ponta de origin\/main/ })
    expect(decidirInicioLocal({ url: NUVEM, onFly: false, sondar: sonda({ atOriginMain: null, inOriginMain: null }) })).toMatchObject({ permitido: false, motivo: /origin\/main não existe/ })
    expect(decidirInicioLocal({ url: NUVEM, onFly: false, sondar: () => ({ ok: false, error: "HEAD indeterminado" }) })).toMatchObject({ permitido: false })
    // URL ausente não é "local": falha para o lado de exigir o checkout canônico.
    expect(decidirInicioLocal({ url: undefined, onFly: false, sondar: () => ({ ok: false, error: "x" }) })).toMatchObject({ permitido: false })
  })

  /** Repositório git TEMPORÁRIO de verdade (local, sem rede), com o `.env.local` ignorado como no projeto. */
  function checkout(): { raiz: string; g: (...a: string[]) => string } {
    const raiz = raizTemporaria()
    mkdirSync(path.join(raiz, ".next", "standalone"), { recursive: true })
    writeFileSync(
      path.join(raiz, ".next", "standalone", "server.js"),
      'require("fs").writeFileSync(process.env.SAIDA_SONDA, JSON.stringify(Object.keys(process.env)))\n',
    )
    const g = (...a: string[]) => execFileSync("git", a, { cwd: raiz, stdio: "pipe", encoding: "utf8" }).trim()
    writeFileSync(path.join(raiz, ".gitignore"), ".env*\n.next/\nchaves.json\n")
    writeFileSync(path.join(raiz, "codigo.txt"), "v1\n")
    g("init", "-q", "-b", "main")
    g("-c", "user.email=t@t", "-c", "user.name=t", "add", ".gitignore", "codigo.txt")
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "c1")
    g("update-ref", "refs/remotes/origin/main", "HEAD")
    return { raiz, g }
  }
  function subir(raiz: string, url = NUVEM) {
    const saida = path.join(raiz, "chaves.json")
    const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts/start-standalone.mjs")], {
      cwd: raiz,
      env: { PATH: process.env.PATH ?? "", SAIDA_SONDA: saida, PORT: "3198", NEXT_PUBLIC_SUPABASE_URL: url } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20_000,
    })
    let chaves: string[] | null = null
    try {
      chaves = JSON.parse(readFileSync(saida, "utf8")) as string[]
    } catch {
      chaves = null
    }
    return { status: r.status, stderr: r.stderr, chaves }
  }

  it("canônico (limpo, HEAD na ponta) + nuvem ⇒ sobe, com o ambiente do #571 intacto", () => {
    const { raiz } = checkout()
    const r = subir(raiz)
    expect(r.status).toBe(0)
    expect(r.chaves?.[0]).toBe("PORT")
    for (const chave of CREDENCIAIS_SO_DE_SCRIPT) expect(r.chaves).not.toContain(chave)
  })

  it("arquivos NÃO rastreados e ignorados não bloqueiam", () => {
    const { raiz } = checkout()
    writeFileSync(path.join(raiz, "notas-locais.md"), "rascunho\n")
    expect(subir(raiz).status).toBe(0)
  })

  it("HEAD diferente da ponta de origin/main ⇒ RECUSA, e o servidor nem é chamado", () => {
    const { raiz, g } = checkout()
    writeFileSync(path.join(raiz, "codigo.txt"), "v2\n")
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-am", "c2")
    const r = subir(raiz)
    expect(r.status).toBe(1)
    expect(r.chaves).toBeNull()
    expect(r.stderr).toMatch(/npm start RECUSADO.*não é a ponta de origin\/main/)
  })

  it("arquivo RASTREADO modificado ⇒ RECUSA", () => {
    const { raiz } = checkout()
    writeFileSync(path.join(raiz, "codigo.txt"), "editado\n")
    const r = subir(raiz)
    expect(r.status).toBe(1)
    expect(r.chaves).toBeNull()
    expect(r.stderr).toMatch(/rastreados modificados/)
  })

  it("sem git + nuvem ⇒ RECUSA (fail closed); sem git + banco local ⇒ sobe (o caso do smoke:logado)", () => {
    const raiz = raizTemporaria()
    mkdirSync(path.join(raiz, ".next", "standalone"), { recursive: true })
    writeFileSync(path.join(raiz, ".next", "standalone", "server.js"), 'require("fs").writeFileSync(process.env.SAIDA_SONDA, "[]")\n')
    expect(subir(raiz, NUVEM).status).toBe(1)
    expect(subir(raiz, LOCAL).status).toBe(0)
  })

  it("o Fly não passa por este lançador: a imagem roda `node server.js` e não leva `.git`", () => {
    const dockerfile = readFileSync(path.join(RAIZ, "Dockerfile"), "utf8")
    expect(dockerfile).toMatch(/^CMD \["node", "server\.js"\]\s*$/m)
    expect(dockerfile).not.toMatch(/start-standalone|npm start|\bgit\b/)
    expect(readFileSync(path.join(RAIZ, ".dockerignore"), "utf8").split("\n").map((l) => l.trim())).toContain(".git")
    expect(readFileSync(path.join(RAIZ, "package.json"), "utf8")).toMatch(/"start": "node scripts\/start-standalone\.mjs"/)
  })
})

/** Tirar do servidor uma chave que o app USA quebraria o runtime calado — a lista não pode crescer assim. */
describe("as credenciais retiradas não são usadas pelo código de runtime", () => {
  const DIRS = ["app", "lib", "server", "components"]
  const ARQUIVOS_RAIZ = ["middleware.ts", "instrumentation.ts", "next.config.ts"]
  function fontes(dir: string): string[] {
    const out: string[] = []
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome)
      if (statSync(p).isDirectory()) out.push(...fontes(p))
      else if (/\.(ts|tsx|js|mjs)$/.test(nome)) out.push(p)
    }
    return out
  }
  it.each(CREDENCIAIS_SO_DE_SCRIPT)("%s não aparece fora de comentário no runtime", (chave) => {
    const arquivos = [...DIRS.flatMap((d) => fontes(path.join(RAIZ, d))), ...ARQUIVOS_RAIZ.map((f) => path.join(RAIZ, f))]
    const usos = arquivos.flatMap((arquivo) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha) && new RegExp(`\\b${chave}\\b`).test(linha))
        .map(() => path.relative(RAIZ, arquivo)),
    )
    expect(usos).toEqual([])
  })
})
