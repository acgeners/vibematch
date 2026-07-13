"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { getCurrentUserRole } from "@/server/actions/admin"
import { useChromeData } from "@/lib/use-refresh"
import { roleAllows } from "@/lib/plans/roles"
import type { Permission, Role } from "@/lib/plans/roles"

// Leva o PAPEL do usuário (migration 140) do servidor pro client, pra esconder o que
// ele não pode fazer. Antes era um booleano `isAdmin`; virou papel porque agora há
// TRÊS níveis — o Assinante vê controles que o Leitor não vê (ex.: "Atualizar dados").
//
// Isto é só a camada de UI. O bloqueio REAL é server-side (`ensurePermission` /
// `ensureAdmin` nas actions) — esconder botão nunca foi proteção: toda server action é
// um endpoint HTTP, chamável por POST com ou sem botão na tela.
//
// Default `leitor` = fail-closed: nenhum controle aparece antes de o fetch CONFIRMAR o
// papel. O visitante (o caso comum em produção) não vê botão de escrita piscar; quem
// tem papel maior toma um flash mínimo até confirmar.
// Re-sincroniza no `app:chrome-refresh` (login/logout mudam o papel).
const RoleContext = createContext<Role>("leitor")

/** Papel do usuário atual. */
export function useRole(): Role {
  return useContext(RoleContext)
}

/** True quando o papel atual libera a permissão. Prefira isto a comparar papel na mão. */
export function useCan(permission: Permission): boolean {
  return roleAllows(useContext(RoleContext), permission)
}

/**
 * True quando o usuário é o Curador (dono do catálogo).
 * Mantido com este nome porque dezenas de componentes já o usam; hoje é DERIVADO do
 * papel. Em código NOVO prefira `useCan(verbo)` — ele diz o que está sendo protegido.
 */
export function useIsAdmin(): boolean {
  return useContext(RoleContext) === "curador"
}

// TTL longo: o papel só muda em login/logout (que já forçam refresh do chrome) ou numa
// troca de plano. 5 min cobre a reconciliação por navegação.
const ROLE_TTL_MS = 300_000

export function AdminProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("leitor")
  useChromeData(getCurrentUserRole, setRole, ROLE_TTL_MS)
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
}
