import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante de infra do `vibematch-flaresolverr`: a imagem é construída pelo Dockerfile do repo,
 * a base é uma versão FIXADA por digest, e o processo do FlareSolverr sobe ATRAVÉS do watchdog.
 *
 * Por que isto merece teste: os três jeitos de desfazer isto não quebram build nem deploy.
 * - Voltar para `image = "...:latest"` no toml descarta o watchdog E troca a versão em silêncio
 *   (`:latest` já aponta para a 3.5.2 e a Fly roda a 3.5.0; o `isFlareSolverrPageTimeout` casa a
 *   mensagem de timeout desta versão).
 * - Tirar o digest do FROM faz a mesma troca de versão no próximo build.
 * - Um CMD que chame o Python direto continua subindo normalmente — só que sem watchdog, e a falha
 *   de 05/10 (processo vivo e mudo, `on-failure` nunca dispara) volta sem nada acusar.
 */
const ROOT = process.cwd()
const TOML = "fly.flaresolverr.toml"
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const semComentario = (s: string) => s.replace(/#.*$/gm, "")

/** Corpo da seção `[build]` do toml, sem comentários. */
function secaoBuild(): string {
  const m = semComentario(read(TOML)).match(/^\[build\]\s*$([\s\S]*?)(?=^\[)/m)
  return m?.[1] ?? ""
}

/** Valor de `dockerfile = "..."` no `[build]`, ou null. */
function dockerfileDoToml(): string | null {
  return secaoBuild().match(/^\s*dockerfile\s*=\s*"([^"]+)"/m)?.[1] ?? null
}

/** Instruções do Dockerfile (comentários e diretivas fora). */
function instrucoes(caminho: string): string {
  return semComentario(read(caminho))
}

describe("infra: o FlareSolverr da Fly roda a imagem fixada, através do watchdog", () => {
  it(`${TOML} constrói pelo Dockerfile do repo, nunca por imagem pronta`, () => {
    const build = secaoBuild()
    expect(build, `${TOML} precisa de uma seção [build]`).not.toBe("")
    expect(
      build,
      "`image = ...` no [build] descarta o Dockerfile — e com ele o watchdog e a versão fixada",
    ).not.toMatch(/^\s*image\s*=/m)

    const dockerfile = dockerfileDoToml()
    expect(dockerfile, "o [build] precisa apontar `dockerfile = ...`").not.toBeNull()
    expect(existsSync(join(ROOT, dockerfile!)), `${dockerfile} não existe`).toBe(true)
  })

  it("a base é uma versão explícita presa por digest completo, nunca :latest", () => {
    const from = instrucoes(dockerfileDoToml()!).match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/m)?.[1]
    expect(from, "Dockerfile sem FROM").toBeDefined()
    expect(from).toMatch(/^ghcr\.io\/flaresolverr\/flaresolverr:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/)
  })

  it("o CMD sobe o FlareSolverr através do watchdog copiado para a imagem", () => {
    const dockerfile = dockerfileDoToml()!
    const corpo = instrucoes(dockerfile)

    const copy = corpo.match(/^COPY\s+(\S*watchdog\.sh)\s+(\S+)/m)
    expect(copy, "o Dockerfile precisa copiar o watchdog.sh").not.toBeNull()
    const [, origem, destino] = copy!
    expect(existsSync(join(ROOT, origem)), `${origem} não existe no repo`).toBe(true)

    const cmdJson = corpo.match(/^CMD\s+(\[.*\])\s*$/m)?.[1]
    expect(cmdJson, "o CMD precisa estar na forma JSON").toBeDefined()
    const cmd = JSON.parse(cmdJson!) as string[]
    expect(cmd[0], "o watchdog roda pelo sh").toBe("/bin/sh")
    expect(cmd[1], "o CMD precisa executar o watchdog copiado — senão o Python sobe sem ele").toBe(
      destino,
    )
    expect(cmd.length, "o watchdog precisa receber o comando do FlareSolverr para fazer exec").toBeGreaterThan(2)
  })
})
