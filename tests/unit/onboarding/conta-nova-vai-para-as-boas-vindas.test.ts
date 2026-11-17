import { describe, it, expect, vi, beforeEach } from "vitest"
import { FRESH_ACCOUNT_WINDOW_MS, isFreshAccount, landingAfterAuth } from "@/lib/onboarding/fresh-account"

/**
 * Só o cadastro por email desviava para `/welcome`. Quem criava a conta pelo Google — o primeiro
 * botão da tela de cadastro — voltava pelo `/auth/callback` direto para a home e nunca via as
 * boas-vindas. A régua é a idade da conta, não o botão.
 */

const AGORA = Date.parse("2026-11-17T12:00:00Z")
const haMinutos = (m: number) => new Date(AGORA - m * 60_000).toISOString()

describe("conta nova", () => {
  it("criada agora é nova; criada ontem não", () => {
    expect(isFreshAccount(haMinutos(0.1), AGORA)).toBe(true)
    expect(isFreshAccount(haMinutos(60 * 24), AGORA)).toBe(false)
  })

  it("a janela é a declarada, nas duas direções (relógio desencontrado)", () => {
    const limite = FRESH_ACCOUNT_WINDOW_MS / 60_000
    expect(isFreshAccount(haMinutos(limite - 1), AGORA)).toBe(true)
    expect(isFreshAccount(haMinutos(limite + 1), AGORA)).toBe(false)
    expect(isFreshAccount(haMinutos(-1), AGORA)).toBe(true)
  })

  it("sem data, ou data inválida, não é nova", () => {
    expect(isFreshAccount(null, AGORA)).toBe(false)
    expect(isFreshAccount("ontem", AGORA)).toBe(false)
  })

  it("só troca o destino padrão: `next` explícito vence", () => {
    expect(landingAfterAuth("/", haMinutos(1), AGORA)).toBe("/welcome")
    expect(landingAfterAuth("/reset-password", haMinutos(1), AGORA)).toBe("/reset-password")
    expect(landingAfterAuth("/", haMinutos(60 * 24 * 30), AGORA)).toBe("/")
  })
})

let criadaEm: string | undefined
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ data: { user: { created_at: criadaEm } }, error: null }),
    },
  }),
}))

describe("o callback do OAuth usa a régua", () => {
  beforeEach(() => {
    criadaEm = undefined
  })

  it("conta recém-criada pelo Google vai para as boas-vindas", async () => {
    criadaEm = new Date(Date.now() - 30_000).toISOString()
    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(new Request("https://satoria.fly.dev/auth/callback?code=abc"))
    expect(res.headers.get("Location")).toBe("/welcome")
  })

  it("conta antiga entrando pelo Google vai para a home", async () => {
    criadaEm = "2026-08-01T00:00:00Z"
    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(new Request("https://satoria.fly.dev/auth/callback?code=abc"))
    expect(res.headers.get("Location")).toBe("/")
  })
})
