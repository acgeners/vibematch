import { AuthHero } from "@/components/auth/auth-hero"
import { SignupForm } from "@/components/auth/signup-form"
import { Wordmark } from "@/components/auth/wordmark"

export const metadata = { title: "Criar conta" }

export default function SignupPage() {
  return (
    <div className="grid min-h-dvh md:grid-cols-[1.05fr_1fr]">
      <AuthHero />

      <div className="flex items-center justify-center px-7 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
          <div className="md:hidden">
            <Wordmark size="sm" />
          </div>

          <div>
            <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em]">Criar conta</h1>
            <p className="text-sm text-muted-foreground">Grátis pra começar. Leva menos de um minuto.</p>
          </div>

          <SignupForm />
        </div>
      </div>
    </div>
  )
}
