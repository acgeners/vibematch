import Link from "next/link"
import { cookies } from "next/headers"
import { AuthHero } from "@/components/auth/auth-hero"
import { LoginForm } from "@/components/auth/login-form"
import { Wordmark } from "@/components/auth/wordmark"
import {
  LAST_EMAIL_COOKIE,
  SESSION_PERSIST_COOKIE,
  persistFromCookieValue,
} from "@/lib/auth-preference"

export const metadata = { title: "Entrar — SatorIA" }

export default async function LoginPage() {
  // Lido no SERVIDOR e passado como prop: é o padrão de `lib/sidebar-preference.ts`. Vindo de
  // localStorage, o campo sairia vazio no SSR e preenchido no cliente — hidratação divergente.
  const cookieStore = await cookies()
  const defaultEmail = cookieStore.get(LAST_EMAIL_COOKIE)?.value ?? ""
  const defaultRemember = persistFromCookieValue(cookieStore.get(SESSION_PERSIST_COOKIE)?.value)

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.05fr_1fr]">
      <AuthHero />

      <div className="flex items-center justify-center px-7 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
          <div className="md:hidden">
            <Wordmark size="sm" />
          </div>

          <div>
            <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em]">Entrar</h1>
            <p className="text-sm text-muted-foreground">Bom te ver de novo. Acesse sua conta.</p>
          </div>

          <LoginForm defaultEmail={defaultEmail} defaultRemember={defaultRemember} />

          <p className="text-center text-[13px] text-muted-foreground">
            Primeira vez aqui?{" "}
            <Link href="/sobre" className="font-medium text-primary hover:underline">
              Conheça a SatorIA
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
