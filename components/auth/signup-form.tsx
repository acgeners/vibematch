"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signUpAction } from "@/server/actions/auth"
import type { AuthState } from "@/server/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthState = {}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initial)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Criando…" : "Criar conta"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  )
}
