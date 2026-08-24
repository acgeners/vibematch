"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  LAST_EMAIL_COOKIE,
  LAST_EMAIL_MAX_AGE,
  SESSION_PERSIST_COOKIE,
} from "@/lib/auth-preference"
import { getSiteUrl } from "@/lib/site-url"

export interface AuthState {
  error?: string
  message?: string
}

/**
 * Grava as duas preferências do `/login`. Roda ANTES do `signInWithPassword` para que o
 * middleware já veja a escolha no primeiro request depois do redirect.
 */
async function rememberLoginPreferences(email: string, persist: boolean): Promise<void> {
  const cookieStore = await cookies()

  if (persist) {
    // Ausência = persistir (o padrão histórico); guardar `"1"` só criaria um segundo jeito
    // de dizer a mesma coisa.
    cookieStore.delete(SESSION_PERSIST_COOKIE)
    cookieStore.set(LAST_EMAIL_COOKIE, email, {
      maxAge: LAST_EMAIL_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
    return
  }

  // Sem maxAge nos dois: o flag e o email morrem junto com o browser. Lembrar o email de
  // quem pediu para NÃO ficar conectado entregaria, na máquina emprestada, exatamente o
  // dado que a pessoa quis não deixar para trás.
  cookieStore.set(SESSION_PERSIST_COOKIE, "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  })
  cookieStore.delete(LAST_EMAIL_COOKIE)
}

/**
 * Login por email/senha (Supabase Auth). Assinatura de useActionState.
 * Em sucesso, redirect("/") (redirect lança NEXT_REDIRECT — não cai no return).
 */
export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  // Checkbox ausente do FormData = desmarcado, igual a um checkbox nativo.
  const persist = formData.get("remember") != null
  if (!email || !password) return { error: "Informe email e senha." }

  // `persistSession` vai explícito: a sessão nasce neste mesmo request, antes de o cookie de
  // preferência estar legível — depender dele aqui seria depender da ordem de escrita.
  const supabase = await createClient({ persistSession: persist })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  await rememberLoginPreferences(email, persist)
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

  // Cadastro com sessão → onboarding (decisão 1 do fluxo de boas-vindas: roda DEPOIS
  // do cadastro, gravando direto nas tabelas). Quem confirma por email entra depois
  // pela home — o card "Primeiros passos" (ponte) cobre esse caminho.
  if (data.session) redirect("/welcome")
  return { message: "Conta criada. Confirme pelo link enviado ao seu email para entrar." }
}

/**
 * Pede o email de redefinição de senha.
 *
 * 🔴 A resposta é a MESMA exista ou não a conta. Um "email não encontrado" transformaria esta
 * tela num verificador de cadastro: qualquer pessoa poderia descobrir quem tem conta aqui,
 * testando endereços um a um. O preço é que quem digita errado não é avisado — por isso a
 * mensagem diz "se existir conta com esse email".
 */
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email) return { error: "Informe seu email." }

  const supabase = await createClient()
  // O link do email chega no callback com `?code=`; ele troca por sessão e joga em /reset-password,
  // que é onde a troca de fato acontece.
  //
  // O host vai junto porque em dev `localhost` e `127.0.0.1` não compartilham cookie, e o
  // callback precisa do code verifier gravado por ESTE request (ver lib/site-url.ts).
  const requestHost = (await headers()).get("host")
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteUrl(requestHost)}/auth/callback?next=/reset-password`,
  })

  // Só erro de INFRA aparece (SMTP fora, limite de envio estourado). "Email não existe" não é
  // erro do Supabase aqui justamente para não vazar a informação.
  if (error) return { error: error.message }

  return {
    message:
      "Se existir uma conta com esse email, o link de redefinição já está a caminho. Confira também o spam.",
  }
}

/**
 * Grava a senha nova. Depende da sessão que o link do email criou — sem ela, `updateUser`
 * não tem em quem escrever, e é isso que impede alguém de trocar a senha de outra pessoa
 * só por abrir a URL.
 */
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "")
  const confirm = String(formData.get("confirm") ?? "")
  if (!password || !confirm) return { error: "Preencha os dois campos." }
  if (password !== confirm) return { error: "As senhas não são iguais." }
  if (password.length < 8) return { error: "A senha precisa de ao menos 8 caracteres." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error: "Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.",
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  redirect("/")
}

/** Logout. Ainda não está ligado na navegação — exposto pra uso futuro (Fase 3). */
/**
 * ⚠️ NÃO acrescente `revalidatePath("/", "layout")` nas transições de sessão achando que ele
 * conserta o chrome. Eu acrescentei, e a ablação de 2026-08-24 o refutou — quatro variantes
 * medidas no mesmo build, login e logout:
 *
 *   revalidatePath + reconciliação do anônimo   login corrige em 210ms
 *   revalidatePath SOZINHO                      login NÃO corrige em 6s
 *   reconciliação do anônimo SOZINHA            login corrige em 238ms
 *   nenhum dos dois                             login NÃO corrige em 6s
 *
 * As linhas 2 e 4 são indistinguíveis: o `revalidatePath` não teve efeito observável em fluxo
 * nenhum. A razão é estrutural — o layout RAIZ não re-renderiza em navegação client-side, então
 * invalidar o cache do servidor não faz a prop nova alcançar um Provider já montado. Quem
 * corrige é a reconciliação do cliente (ver `AdminProvider`).
 *
 * ⚠️ O logout funciona nas QUATRO variantes — ele nunca precisou de nada.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
