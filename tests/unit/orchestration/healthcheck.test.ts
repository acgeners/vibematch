import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * O que este arquivo prende: que o healthcheck FALHE quando o banco falha.
 *
 * O caminho feliz é fácil e inútil de testar sozinho — o monitor que existia antes também
 * passava, porque checava `/sobre` e `/`, rotas que não tocam o banco. Produção ficou três dias
 * respondendo 200 com TODA leitura quebrada (`Invalid API key`) e ninguém soube.
 *
 * Os dois ramos de falha são o valor: erro do PostgREST e catálogo vazio. O segundo é o mais
 * traiçoeiro — a query "funciona" e devolve zero, que é o sintoma de credencial trocada ou banco
 * errado. Um health que aceita 0 como saudável repete exatamente o bug que ele existe pra pegar.
 */

let queryResult: { count: number | null; error: { message: string } | null }

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve(queryResult),
      }),
    }),
  }),
}))

const { GET } = await import("@/app/api/health/route")

describe("healthcheck exercita o banco", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("200 quando o catálogo responde", async () => {
    queryResult = { count: 966, error: null }
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, works: 966 })
  })

  it("503 quando a query falha (o caso `Invalid API key` de 2026-08-03)", async () => {
    queryResult = { count: null, error: { message: "Invalid API key" } }
    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false, check: "db" })
  })

  it("503 quando o catálogo volta VAZIO — query ok, resultado impossível", async () => {
    queryResult = { count: 0, error: null }
    const res = await GET()
    expect(res.status).toBe(503)
  })

  it("não vaza a mensagem crua do banco na resposta (repo e endpoint são públicos)", async () => {
    queryResult = { count: null, error: { message: "permission denied for relation works" } }
    const res = await GET()
    expect(JSON.stringify(await res.json())).not.toContain("permission denied")
  })
})
