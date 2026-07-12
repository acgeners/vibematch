"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export interface AuthState {
  error?: string
  message?: string
}

/**
 * Login por email/senha (Supabase Auth). Assinatura de useActionState.
 * Em sucesso, redirect("/") (redirect lança NEXT_REDIRECT — não cai no return).
 */
export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "Informe email e senha." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  redirect("/")
}

/**
 * Signup por email/senha. O trigger handle_new_user (migration 137) provisiona
 * a linha de user_settings com plano FREE. Se a confirmação de email estiver
 * desligada, já vem sessão → home; senão, instrui a confirmar pelo email.
 */
export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!name || !email || !password) return { error: "Preencha nome, email e senha." }
  if (password.length < 8) return { error: "A senha precisa de ao menos 8 caracteres." }

  const supabase = await createClient()
  // name vai em user_metadata → o trigger handle_new_user (mig 137) grava em display_name.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  })
  if (error) return { error: error.message }

  if (data.session) redirect("/")
  return { message: "Conta criada. Confirme pelo link enviado ao seu email para entrar." }
}

/** Logout. Ainda não está ligado na navegação — exposto pra uso futuro (Fase 3). */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
