"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signInAction } from "@/server/actions/auth"
import type { AuthState } from "@/server/actions/auth"
import { GoogleButton } from "./google-button"
import { Divider } from "./auth-bits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthState = {}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial)

  return (
    <div className="flex flex-col gap-[22px]">
      <GoogleButton label="Entrar com Google" />
      <Divider>ou com email</Divider>

      <form action={formAction} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            required
          />
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
