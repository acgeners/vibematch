import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CREDENCIAIS_SO_DE_SCRIPT, ambienteDoServidor, carregarEnvLocal } from "@/scripts/lib/standalone-env.mjs"

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
      env: { PATH: process.env.PATH ?? "", SAIDA_SONDA: saida, SUPABASE_DB_PASSWORD: "do-shell", PORT: "3197" } as unknown as NodeJS.ProcessEnv,
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
