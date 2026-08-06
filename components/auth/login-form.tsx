"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signInAction } from "@/server/actions/auth"
import type { AuthState } from "@/server/actions/auth"
import { GoogleButton } from "./google-button"
import { Divider } from "./auth-bits"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthState = {}

interface LoginFormProps {
  /** Último email que entrou com sucesso, lido do cookie pelo servidor (nunca a senha). */
  defaultEmail?: string
  /** Estado do "Manter-me conectado" — desmarcado só se a pessoa desmarcou nesta sessão. */
  defaultRemember?: boolean
}

export function LoginForm({ defaultEmail = "", defaultRemember = true }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(signInAction, initial)

  return (
    <div className="flex flex-col gap-[22px]">
      <GoogleButton label="Entrar com Google" />
      <Divider>ou com email</Divider>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="voce@email.com"
            autoComplete="email"
            defaultValue={defaultEmail}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password">Senha</Label>
            <Link
              href="/recuperar-senha"
              className="text-[13px] text-muted-foreground hover:text-foreground hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        <div className="flex items-center gap-2">
          {/* `value="1"` + ausência quando desmarcado = semântica de checkbox nativo, que é o
              que `signInAction` espera ler do FormData. */}
          <Checkbox id="remember" name="remember" value="1" defaultChecked={defaultRemember} />
          <Label htmlFor="remember" className="text-[13px] font-normal text-muted-foreground">
            Manter-me conectado
          </Label>
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" className="h-[46px] w-full text-[15px]" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Não tem conta?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  )
}
