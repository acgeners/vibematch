// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { SIGNED_IN_HEADER } from "@/lib/auth/signed-in-header"

// O middleware avisa a página se há sessão, para a barra superior nascer certa. Sem isso quem
// estava logado via "Entrar" e só "Catálogo" até uma chamada do navegador voltar.

let fakeUser: { id: string } | null = null
let refreshCookies: { name: string; value: string; options: Record<string, unknown> }[] = []

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: typeof refreshCookies) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        // O refresh do token grava cookies DURANTE o getUser, como o @supabase/ssr faz.
        if (refreshCookies.length) opts.cookies.setAll(refreshCookies)
        return { data: { user: fakeUser } }
      },
    },
  }),
}))

const { updateSession } = await import("@/lib/supabase/middleware")

/** O que a página recebe: o Next repassa cabeçalhos da requisição por estes nomes. */
const forwarded = (res: Response) => res.headers.get(`x-middleware-request-${SIGNED_IN_HEADER}`)

beforeEach(() => {
  fakeUser = null
  refreshCookies = []
})

describe("updateSession: a página sabe se há sessão", () => {
  it("com sessão, repassa 1", async () => {
    fakeUser = { id: "u1" }
    const { response, user } = await updateSession(new NextRequest("http://localhost:3000/ranking"))
    expect(user?.id).toBe("u1")
    expect(forwarded(response)).toBe("1")
  })

  it("sem sessão, repassa 0", async () => {
    const { response } = await updateSession(new NextRequest("http://localhost:3000/ranking"))
    expect(forwarded(response)).toBe("0")
  })

  it("um valor mandado pelo cliente não passa adiante", async () => {
    const req = new NextRequest("http://localhost:3000/ranking", { headers: { [SIGNED_IN_HEADER]: "1" } })
    const { response } = await updateSession(req)
    expect(forwarded(response)).toBe("0")
  })

  it("os cookies do refresh continuam na resposta, com as opções deles", async () => {
    fakeUser = { id: "u1" }
    refreshCookies = [
      { name: "sb-ref-auth-token", value: "novo-token", options: { path: "/", maxAge: 3600, sameSite: "lax" } },
    ]
    const { response } = await updateSession(new NextRequest("http://localhost:3000/"))
    const cookie = response.cookies.get("sb-ref-auth-token")
    expect(cookie?.value).toBe("novo-token")
    expect(cookie?.maxAge).toBe(3600)
    expect(cookie?.path).toBe("/")
    expect(forwarded(response)).toBe("1")
  })
})
