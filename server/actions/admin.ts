"use server"

import { isCurrentUserAdmin } from "@/server/queries/current-user"

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
