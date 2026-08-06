"use client"

import { useActionState } from "react"
import Link from "next/link"
import { requestPasswordResetAction } from "@/server/actions/auth"
import type { AuthState } from "@/server/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthState = {}

export function ResetRequestForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initial)

  // Depois do envio o formulário sai de cena: deixá-lo na tela convida a reenviar, e o limite
  // de emails por hora do Supabase transformaria isso num erro logo no segundo clique.
  if (state.message) {
    return (
      <div className="flex flex-col gap-[22px]">
        <div className="rounded-xl border border-border bg-accent/40 px-4 py-3.5 text-sm leading-relaxed text-accent-foreground">
          {state.message}
        </div>
        <Link
          href="/login"
          className="text-center text-sm font-medium text-primary hover:underline"
        >
          Voltar para entrar
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[22px]">
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

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" className="h-[46px] w-full text-[15px]" disabled={pending}>
          {pending ? "Enviando…" : "Enviar link de redefinição"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Lembrou a senha?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
