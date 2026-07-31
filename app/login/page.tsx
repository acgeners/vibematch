import Link from "next/link"
import { AuthHero } from "@/components/auth/auth-hero"
import { LoginForm } from "@/components/auth/login-form"
import { Wordmark } from "@/components/auth/wordmark"

export const metadata = { title: "Entrar — SatorIA" }

export default function LoginPage() {
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

          <LoginForm />

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
