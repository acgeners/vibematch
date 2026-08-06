import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { applySessionPersistence, persistFromCookieValue } from "@/lib/auth-preference"

describe("persistFromCookieValue", () => {
  it("sem cookie = persistir (o comportamento histórico)", () => {
    // Importa porque, quando o checkbox nasceu, todo mundo que já estava logado estava
    // exatamente neste estado: sem o cookie. Se a ausência significasse "não persistir",
    // a entrega derrubaria a sessão de todos.
    expect(persistFromCookieValue(undefined)).toBe(true)
  })

  it("só o literal \"0\" desliga a persistência", () => {
    expect(persistFromCookieValue("0")).toBe(false)
    expect(persistFromCookieValue("1")).toBe(true)
    expect(persistFromCookieValue("")).toBe(true)
  })
})

describe("applySessionPersistence", () => {
  it("com persistir, devolve as opções intactas", () => {
    const options = { maxAge: 3600, expires: new Date(0), path: "/", httpOnly: true }
    expect(applySessionPersistence(options, true)).toBe(options)
  })

  it("sem persistir, tira maxAge E expires — qualquer um dos dois sobrevive ao browser", () => {
    const out = applySessionPersistence(
      { maxAge: 3600, expires: new Date(0), path: "/", sameSite: "lax" as const },
      false
    )
    expect(out).not.toHaveProperty("maxAge")
    expect(out).not.toHaveProperty("expires")
  })

  it("sem persistir, preserva o resto das opções", () => {
    const out = applySessionPersistence(
      { maxAge: 3600, path: "/", httpOnly: true, secure: true, sameSite: "lax" as const },
      false
    )
    // Perder `httpOnly`/`secure` aqui trocaria um problema de conveniência por um de
    // segurança — o cookie de auth ficaria legível por script.
    expect(out).toEqual({ path: "/", httpOnly: true, secure: true, sameSite: "lax" })
  })

  it("tolera options ausente", () => {
    expect(applySessionPersistence(undefined, false)).toBeUndefined()
  })
})

/**
 * Teste de ARQUITETURA (ver tests/unit/orchestration/): "Manter-me conectado" só é honesto se
 * TODO ponto que escreve cookie de auth aplicar a preferência. Hoje são dois — o cliente de
 * server actions e o refresh do middleware — e esquecer o segundo não quebra nada: o refresh
 * simplesmente devolve o `maxAge` na navegação seguinte e a escolha do usuário evapora.
 *
 * Varre em vez de conferir uma lista fixa, de propósito: uma lista só vigia os arquivos que
 * alguém lembrou de apontar, e o ponto de escrita novo é justamente o que ninguém apontou.
 */
describe("todo cliente Supabase que grava cookie respeita a preferência", () => {
  function collectFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) collectFiles(full, acc)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) acc.push(full)
    }
    return acc
  }

  it("todo arquivo que chama createServerClient com setAll usa applySessionPersistence", () => {
    const root = process.cwd()
    const files = [
      ...collectFiles(join(root, "lib")),
      ...collectFiles(join(root, "app")),
      ...collectFiles(join(root, "server")),
    ]

    const faltando = files.filter((file) => {
      const src = readFileSync(file, "utf8")
      if (!src.includes("createServerClient(")) return false
      // Cliente que não escreve cookie (só lê) não tem o que aplicar.
      if (!src.includes("setAll")) return false
      return !src.includes("applySessionPersistence")
    })

    expect(faltando.map((f) => f.slice(root.length + 1))).toEqual([])
  })
})
