import Link from "next/link"
import { AuthHero } from "@/components/auth/auth-hero"
import { NewPasswordForm } from "@/components/auth/new-password-form"
import { Wordmark } from "@/components/auth/wordmark"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Nova senha — SatorIA" }

export default async function NovaSenhaPage() {
  // O link do email passa pelo /auth/callback, que troca o `code` por sessão. Sem sessão aqui,
  // ou o link expirou ou alguém chegou pela URL direto — em vez de mostrar um formulário que
  // só falharia no submit, a tela já diz o que fazer.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.05fr_1fr]">
      <AuthHero />

      <div className="flex items-center justify-center px-7 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
          <div className="md:hidden">
            <Wordmark size="sm" />
          </div>

          {user ? (
            <>
              <div>
                <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em]">Nova senha</h1>
                <p className="text-sm text-muted-foreground">
                  Escolha a senha que você vai usar para entrar em <b>{user.email}</b>.
                </p>
              </div>
              <NewPasswordForm />
            </>
          ) : (
            <>
              <div>
                <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em]">Link expirado</h1>
                <p className="text-sm text-muted-foreground">
                  Este link de redefinição já foi usado ou passou da validade. Peça um novo — leva
                  um minuto.
                </p>
              </div>
              <Link
                href="/recuperar-senha"
                className="inline-flex h-[46px] items-center justify-center rounded-md bg-primary px-4 text-[15px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                Pedir novo link
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
