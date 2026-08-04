import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante de infra: o nome da app de um sidecar no toml DELE tem que ser o mesmo host que o
 * app principal chama no `fly.toml`.
 *
 * Por que isto merece teste: já divergiu DUAS vezes. O PR #288 achou o mismatch e corrigiu só o
 * lado do `fly.toml` — o `fly.flaresolverr.toml` continuou em `satoria-flaresolverr`, então o
 * problema não sumiu, trocou de lado, e a memória do projeto passou a registrar "corrigido no
 * #288" enquanto seguia quebrado.
 *
 * E o sintoma nunca é um erro: os sidecars são fail-soft por design. Com o nome errado, a app
 * principal chama um host sem máquina, o `fetch` falha, o código segue sem ele — e a busca passa
 * a devolver 5 de 9 fontes em vez de 8 de 9, sem log e sem alerta. Você só descobre comparando
 * três lugares (os dois tomls e a lista de apps da Fly), que é como ele foi achado.
 */
const ROOT = process.cwd()
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")

/** Host de uma URL `http://<host>.flycast:porta` numa env do fly.toml. */
function hostChamado(envVar: string): string | null {
  const m = read("fly.toml").match(new RegExp(`${envVar}\\s*=\\s*"([^"]+)"`))
  if (!m) return null
  return new URL(m[1]).hostname.replace(/\.flycast$/, "")
}

/** Valor de `app = "..."` num toml de sidecar. */
function appDeclarada(arquivo: string): string | null {
  if (!existsSync(join(ROOT, arquivo))) return null
  return read(arquivo).match(/^app\s*=\s*"([^"]+)"/m)?.[1] ?? null
}

const PARES = [
  { nome: "FlareSolverr", envVar: "FLARESOLVERR_URL", toml: "fly.flaresolverr.toml" },
  // A fase C ainda não pôs COMIX_RENDER_URL no fly.toml; quando puser, este par passa a valer
  // sozinho — o teste pula enquanto a env não existe, em vez de falhar por algo não feito.
  { nome: "sidecar comix-render", envVar: "COMIX_RENDER_URL", toml: "services/comix-render/fly.toml" },
]

describe("infra: o nome da app do sidecar bate com o host que o app principal chama", () => {
  for (const { nome, envVar, toml } of PARES) {
    it(`${nome}: ${envVar} aponta para a app declarada em ${toml}`, () => {
      const chamado = hostChamado(envVar)
      if (chamado === null) return // env ainda não configurada (fase pendente)

      const declarada = appDeclarada(toml)
      expect(declarada, `${toml} precisa declarar \`app = "..."\``).not.toBeNull()
      expect(
        declarada,
        `fly.toml chama "${chamado}" mas ${toml} declara "${declarada}" — ` +
          `deployar assim cria uma app que ninguém chama, e as fontes somem em SILÊNCIO`,
      ).toBe(chamado)
    })
  }
})
