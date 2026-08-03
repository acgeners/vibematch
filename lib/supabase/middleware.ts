import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { User } from "@supabase/supabase-js"

export interface SessionRefresh {
  response: NextResponse
  /** Usuário da sessão já revalidada, ou null quando anônimo. */
  user: User | null
  /** Cliente com a SESSÃO do usuário — RLS vale. Só para leitura das linhas dele. */
  supabase: ReturnType<typeof createServerClient>
}

/**
 * Refresh da sessão Supabase a cada request. Padrão @supabase/ssr: reescreve os
 * cookies de auth na resposta pra manter o token válido nos Server Components.
 *
 * Devolve também o usuário e o cliente: quem chama decide sobre proteção de rota
 * (ver `middleware.ts`) sem pagar um segundo `getUser()`.
 */
export async function updateSession(request: NextRequest): Promise<SessionRefresh> {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANTE: não remover getUser() — é o que revalida/renova o token de sessão.
  const { data } = await supabase.auth.getUser()

  return { response: supabaseResponse, user: data.user ?? null, supabase }
}
