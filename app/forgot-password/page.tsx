import { cookies } from "next/headers"
import { AuthHero } from "@/components/auth/auth-hero"
import { ResetRequestForm } from "@/components/auth/reset-request-form"
import { Wordmark } from "@/components/auth/wordmark"
import { LAST_EMAIL_COOKIE } from "@/lib/auth-preference"

export const metadata = { title: "Recuperar senha" }

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const defaultEmail = (await cookies()).get(LAST_EMAIL_COOKIE)?.value ?? ""
  // `?error=link` vem do /auth/callback quando o link do email não vale mais.
  const linkInvalido = (await searchParams).error === "link"

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.05fr_1fr]">
      <AuthHero />

      <div className="flex items-center justify-center px-7 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
          <div className="md:hidden">
            <Wordmark size="sm" />
          </div>

          <div>
            <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em]">Recuperar senha</h1>
            <p className="text-sm text-muted-foreground">
              Informe seu email e enviamos um link para você criar uma nova senha.
            </p>
          </div>

          {linkInvalido && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive">
              Aquele link não vale mais — links de redefinição funcionam uma vez só e expiram.
              Peça outro abaixo.
            </p>
          )}

          <ResetRequestForm defaultEmail={defaultEmail} />
        </div>
      </div>
    </div>
  )
}
