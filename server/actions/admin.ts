"use server"

import { getCurrentRole, isCurrentUserAdmin, getSessionUserId } from "@/server/queries/current-user"
import type { Role } from "@/lib/plans/roles"

/**
 * Expõe `isCurrentUserAdmin()` pro client (stopgap multi-user). Admin = o DONO do
 * catálogo (usuário da linha singleton / deslogado). Usado pelo `AdminProvider`
 * pra esconder os controles de MUTAÇÃO do catálogo compartilhado de usuários
 * logados (read-only). O bloqueio real é server-side (`ensureAdmin` nas actions);
 * isto é só a camada de UI. Barato — 1 leitura de sessão memoizada por request.
 */
export async function getCurrentUserIsAdmin(): Promise<boolean> {
  return isCurrentUserAdmin()
}

/**
 * Papel do usuário atual pro client (migration 140). Substitui o booleano `isAdmin`
 * como sinal de UI: agora existem TRÊS níveis, e o Assinante precisa ver controles
 * que o Leitor não vê. O bloqueio real segue server-side (`ensurePermission`).
 */
export async function getCurrentUserRole(): Promise<Role> {
  return getCurrentRole()
}

/** Papel + se HÁ SESSÃO. Ver `getCurrentUserChrome`. */
export interface CurrentUserChrome {
  role: Role
  signedIn: boolean
}

/**
 * O que a UI precisa saber sobre quem está olhando — papel E sessão.
 *
 * ⚠️ O papel sozinho NÃO distingue um visitante anônimo de uma Leitora logada: `getCurrentRole()`
 * é fail-closed em `leitor`, então os dois chegam como "leitor". Isso bastava enquanto o Leitor
 * era espectador (nada pra mostrar aos dois). Com a Fatia 1 ele deixa de ser: a Leitora LOGADA
 * pode favoritar e marcar capítulo (`own_state`), e o anônimo não pode — ele não tem `user_id`
 * pra escrever. Sem o `signedIn`, a UI ou esconderia o coração dela, ou mostraria ao anônimo um
 * botão que só dá erro.
 */
export async function getCurrentUserChrome(): Promise<CurrentUserChrome> {
  const [role, sessionUserId] = await Promise.all([getCurrentRole(), getSessionUserId()])
  return { role, signedIn: sessionUserId != null }
}
