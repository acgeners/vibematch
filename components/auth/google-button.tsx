"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { isLocalSupabaseUrl } from "@/lib/db-target"
import { Button } from "@/components/ui/button"

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

const TRIGGER_CLASS = "h-[46px] w-full gap-2.5 text-[15px]"

/**
 * Login/signup com Google (OAuth). Redireciona pro Google; volta em /auth/callback.
 *
 * 🔴 **No banco LOCAL este botão não tem para onde ir, e falhava DEPOIS do clique.** O
 * `supabase/config.toml` traz todo provider externo com `enabled = false`, então
 * `signInWithOAuth` navegava pro GoTrue e a pessoa caía num JSON cru na barra de endereço:
 * `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is
 * not enabled"}`. Medido em 2026-09-21 no MESMO endpoint: a nuvem devolve **302** pro
 * Google e o local devolve esse **400** — ou seja o botão prometia uma porta que só existe
 * num dos dois alvos.
 *
 * Por isso o ramo local desabilita o gatilho e **nomeia a saída que funciona** (email+senha,
 * que o formulário logo abaixo já oferece), em vez de deixar a pessoa descobrir pelo erro.
 * É a mesma razão do `DbTargetBanner`: as contas dos dois bancos são diferentes, e falhar
 * aqui parece "minha senha não funciona".
 *
 * ⚠️ Custo em produção: **ZERO** — `isLocalSupabaseUrl()` é falso lá e o ramo nunca é
 * alcançado. É o mesmo helper do banner, não uma segunda régua pro mesmo fato.
 *
 * ⚠️ **Não quebra hidratação**, ao contrário do `localStorage` da sidebar: quem decide é
 * `NEXT_PUBLIC_SUPABASE_URL`, embutido em BUILD TIME, então servidor e cliente começam com
 * o mesmo valor.
 *
 * ⚠️ O texto fica VISÍVEL, e não num `title=`: botão desabilitado sai do tab order, então
 * tooltip nativo ali seria explicação inalcançável — capacidade construída e desligada.
 */
export function GoogleButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false)
  const semProvider = isLocalSupabaseUrl()

  async function handleClick() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    // Em sucesso o browser já navegou pro Google; só reabilita se deu erro.
    if (error) setLoading(false)
  }

  if (semProvider) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" className={TRIGGER_CLASS} disabled>
          <GoogleIcon />
          {label}
        </Button>
        <p className="text-center text-[13px] text-muted-foreground">
          Indisponível no banco local — entre com email e senha.
        </p>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={TRIGGER_CLASS}
      onClick={handleClick}
      disabled={loading}
    >
      <GoogleIcon />
      {loading ? "Redirecionando…" : label}
    </Button>
  )
}
