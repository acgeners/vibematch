import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

/**
 * O botão do Google no banco LOCAL.
 *
 * Teste de RENDER de propósito: o que regride aqui não é a régua (ela já tem dono em
 * `lib/db-target.ts`), é o COMPONENTE deixar de consumi-la — e um teste que lesse
 * `isLocalSupabaseUrl()` direto passaria verde com o botão redirecionando pro JSON de erro.
 *
 * 🔴 A contraprova de cada caso é o `process.env` apontando para o ALVO OPOSTO ao do mock.
 * Sem isso os dois casos passariam com uma regex de host copiada dentro do componente — que
 * é exatamente a segunda régua pro mesmo fato que este arquivo existe para impedir.
 */

const alvo = { local: false }
vi.mock("@/lib/db-target", () => ({
  isLocalSupabaseUrl: () => alvo.local,
  supabaseTargetLabel: () => "127.0.0.1:54321",
}))

type OAuthOpts = { provider: string; options?: { redirectTo?: string } }
const oauth = vi.fn<(opts: OAuthOpts) => Promise<{ error: null }>>(async () => ({ error: null }))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: oauth } }),
}))

import { GoogleButton } from "@/components/auth/google-button"

const ENV_ORIGINAL = process.env.NEXT_PUBLIC_SUPABASE_URL

beforeEach(() => {
  oauth.mockClear()
})

afterEach(() => {
  cleanup()
  process.env.NEXT_PUBLIC_SUPABASE_URL = ENV_ORIGINAL
})

describe("GoogleButton: alvo local não oferece porta que não existe", () => {
  it("no LOCAL desabilita o gatilho e nomeia a saída que funciona", () => {
    alvo.local = true
    // Contraprova: o env diz NUVEM. Só passa se a decisão vier do dono único.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://obwlwukwovetgjqdpizd.supabase.co"

    render(<GoogleButton label="Entrar com Google" />)

    const botao = screen.getByRole("button", { name: /Entrar com Google/i })
    expect((botao as HTMLButtonElement).disabled).toBe(true)

    // A saída tem que estar NOMEADA — botão morto sem alternativa é o erro de antes com
    // outra roupa. E visível: `disabled` tira do tab order, então `title=` não alcança.
    const texto = document.body.textContent ?? ""
    expect(texto).toMatch(/banco local/i)
    expect(texto).toMatch(/email e senha/i)
  })

  it("no LOCAL o clique NÃO chama o OAuth que devolveria o 400", () => {
    alvo.local = true
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://obwlwukwovetgjqdpizd.supabase.co"

    render(<GoogleButton label="Entrar com Google" />)
    fireEvent.click(screen.getByRole("button", { name: /Entrar com Google/i }))

    expect(oauth).not.toHaveBeenCalled()
  })

  it("na NUVEM o botão continua funcionando e redireciona pro Google", () => {
    alvo.local = false
    // Contraprova espelhada: o env diz LOCAL e mesmo assim o botão tem que funcionar.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"

    render(<GoogleButton label="Entrar com Google" />)

    const botao = screen.getByRole("button", { name: /Entrar com Google/i })
    expect((botao as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(botao)
    expect(oauth).toHaveBeenCalledTimes(1)
    expect(oauth.mock.calls[0][0]).toMatchObject({ provider: "google" })

    // E o aviso do local não pode vazar pra produção.
    expect(document.body.textContent ?? "").not.toMatch(/banco local/i)
  })
})
