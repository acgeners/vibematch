import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import {
  SESSION_PERSIST_COOKIE,
  applySessionPersistence,
  persistFromCookieValue,
} from "@/lib/auth-preference"
import { SIGNED_IN_HEADER } from "@/lib/auth/signed-in-header"
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
          // "Manter-me conectado" desmarcado ⇒ cookie de sessão. Sem esta linha o refresh
          // devolveria o `maxAge` na primeira navegação e a escolha do usuário evaporaria
          // sem erro nenhum — ver o comentário em `applySessionPersistence`.
          const persist = persistFromCookieValue(request.cookies.get(SESSION_PERSIST_COOKIE)?.value)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, applySessionPersistence(options, persist)),
          )
        },
      },
    },
  )

  // IMPORTANTE: não remover getUser() — é o que revalida/renova o token de sessão.
  const { data } = await supabase.auth.getUser()
  const user = data.user ?? null

  // Diz à página se há sessão (ver `SIGNED_IN_HEADER`). Sempre escrito, para um valor vindo do
  // cliente nunca passar adiante. A resposta é refeita com o cabeçalho e recebe os cookies que
  // o refresh gravou, com as opções deles (o padrão do @supabase/ssr para trocar a resposta).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(SIGNED_IN_HEADER, user ? "1" : "0")
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie)

  return { response, user, supabase }
}
