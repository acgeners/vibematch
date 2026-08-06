import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import {
  SESSION_PERSIST_COOKIE,
  applySessionPersistence,
  persistFromCookieValue,
} from "@/lib/auth-preference"

interface CreateClientOptions {
  /**
   * Sobrescreve o "Manter-me conectado" lido do cookie. Só o `signInAction` passa isto: lá a
   * escolha chega no `FormData` do mesmo request em que a sessão nasce, ou seja, ANTES de o
   * cookie de preferência existir. Nos demais lugares o cookie já está gravado e manda.
   */
  persistSession?: boolean
}

export async function createClient(options?: CreateClientOptions) {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Lido aqui dentro, não na criação do cliente: `signInAction` grava a preferência
          // no mesmo request, e o que vale é o estado no momento da escrita.
          const persist =
            options?.persistSession ??
            persistFromCookieValue(cookieStore.get(SESSION_PERSIST_COOKIE)?.value)
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
              cookieStore.set(name, value, applySessionPersistence(cookieOptions, persist))
            })
          } catch {
            // Server Components cannot set cookies; middleware/actions can.
          }
        },
      },
    }
  )
}
