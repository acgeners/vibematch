import { describe, it, expect, vi } from "vitest"

/**
 * O que este arquivo prende: que o callback do OAuth mande a pessoa para um caminho INTERNO,
 * nunca para um host absoluto.
 *
 * Falha real de 2026-08-04: a rota montava o destino com o `origin` de `request.url`. Em route
 * handler atrás do proxy da Fly isso é o endereço INTERNO do container (`0.0.0.0:3000`), então
 * o login em produção criava a sessão com sucesso e redirecionava para `https://0.0.0.0:3000/`.
 * Nada quebrou, nada logou erro — a pessoa só terminava em lugar nenhum. Ficou meses assim
 * porque ninguém nunca havia logado em prod (o `site_url` do Supabase também apontava para
 * localhost, então o fluxo nem chegava aqui).
 *
 * O segundo caso é de segurança e veio junto: `?next=` ia direto para o `Location`, o que fazia
 * do callback um open redirect (`?next=https://malicioso` ou `//malicioso`).
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: async () => ({ error: null }) },
  }),
}))

const { GET } = await import("@/app/auth/callback/route")

const chamar = (url: string) => GET(new Request(url))

describe("callback do OAuth: destino é sempre caminho interno", () => {
  it("não devolve host absoluto no Location (o bug do 0.0.0.0:3000)", async () => {
    const res = await chamar("https://0.0.0.0:3000/auth/callback?code=abc")
    const loc = res.headers.get("Location")!
    expect(loc.startsWith("/"), `Location deveria ser relativo, veio "${loc}"`).toBe(true)
    expect(loc).not.toMatch(/0\.0\.0\.0|https?:\/\//)
  })

  it("honra ?next quando é caminho interno", async () => {
    const res = await chamar("https://satoria.fly.dev/auth/callback?code=abc&next=/reading")
    expect(res.headers.get("Location")).toBe("/reading")
  })

  for (const hostil of ["https://malicioso.example", "//malicioso.example", "http://0.0.0.0:3000/x"]) {
    it(`ignora ?next hostil (${hostil}) — sem open redirect`, async () => {
      const res = await chamar(
        `https://satoria.fly.dev/auth/callback?code=abc&next=${encodeURIComponent(hostil)}`,
      )
      expect(res.headers.get("Location")).toBe("/")
    })
  }

  it("sem code, manda pro login com erro (ainda relativo)", async () => {
    const res = await chamar("https://satoria.fly.dev/auth/callback")
    expect(res.headers.get("Location")).toBe("/login?error=oauth")
  })
})
