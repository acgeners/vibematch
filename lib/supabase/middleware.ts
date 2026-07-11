import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Refresh da sessão Supabase a cada request. Padrão @supabase/ssr: reescreve os
 * cookies de auth na resposta pra manter o token válido nos Server Components.
 *
 * Não protege rotas ainda (transição single-user → multi-user): sem sessão, o
 * request segue normal e o app cai no fallback singleton em getCurrentUserId.
 * A proteção de rota entra quando o fluxo de login/signup existir (Fase 1b).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
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
  await supabase.auth.getUser()

  return supabaseResponse
}
