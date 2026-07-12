"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signUpAction } from "@/server/actions/auth"
import type { AuthState } from "@/server/actions/auth"
import { GoogleButton } from "./google-button"
import { Divider, PlanNote } from "./auth-bits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthState = {}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initial)

  return (
    <div className="flex flex-col gap-[22px]">
      <GoogleButton label="Continuar com Google" />
      <Divider>ou com email</Divider>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" type="text" placeholder="Como devemos te chamar?" autoComplete="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="voce@email.com" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <span className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</span>
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.message && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</p>
        )}

        <Button type="submit" className="h-[46px] w-full text-[15px]" disabled={pending}>
          {pending ? "Criando…" : "Criar conta"}
        </Button>
      </form>

      <PlanNote />

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
