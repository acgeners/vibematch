"use server"

import { getCurrentRole, isCurrentUserAdmin } from "@/server/queries/current-user"
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
