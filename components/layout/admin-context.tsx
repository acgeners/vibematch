"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { getCurrentUserChrome } from "@/server/actions/admin"
import type { CurrentUserChrome } from "@/server/actions/admin"
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
const RoleContext = createContext<CurrentUserChrome>({ role: "leitor", signedIn: false })

/** Papel do usuário atual. */
export function useRole(): Role {
  return useContext(RoleContext).role
}

/** True quando o papel atual libera a permissão. Prefira isto a comparar papel na mão. */
export function useCan(permission: Permission): boolean {
  return roleAllows(useContext(RoleContext).role, permission)
}

/**
 * True quando o usuário é o Curador (dono do catálogo).
 * Mantido com este nome porque dezenas de componentes já o usam; hoje é DERIVADO do
 * papel. Em código NOVO prefira `useCan(verbo)` — ele diz o que está sendo protegido.
 */
export function useIsAdmin(): boolean {
  return useContext(RoleContext).role === "curador"
}

/** True quando HÁ SESSÃO — qualquer papel. Anônimo é `false`. */
export function useIsSignedIn(): boolean {
  return useContext(RoleContext).signedIn
}

/**
 * True quando o usuário pode escrever o PRÓPRIO estado de leitura (favoritar, status,
 * capítulo lido) — Fatia 1.
 *
 * ⚠️ Precisa de SESSÃO, não só de papel. `own_state` é liberado pro Leitor, e o papel de um
 * anônimo TAMBÉM é `leitor` (fail-closed) — então `useCan("own_state")` sozinho deixaria o
 * coração aparecer pro visitante deslogado, que ao clicar tomaria "Entre na sua conta"
 * (`ensureSignedIn`). O que falta ao anônimo não é permissão, é identidade.
 */
export function useCanWriteOwnState(): boolean {
  const { role, signedIn } = useContext(RoleContext)
  return signedIn && roleAllows(role, "own_state")
}

// TTL longo: o papel só muda em login/logout (que já forçam refresh do chrome) ou numa
// troca de plano. 5 min cobre a reconciliação por navegação.
const ROLE_TTL_MS = 300_000

const ANON: CurrentUserChrome = { role: "leitor", signedIn: false }

export function AdminProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<CurrentUserChrome>(ANON)

  // Só troca o objeto quando o VALOR muda: o poll do chrome devolve um objeto novo a cada
  // 5 min e, como ele é o value do context, uma identidade nova re-renderizaria toda a árvore
  // à toa.
  const onData = useCallback((next: CurrentUserChrome) => {
    setChrome((prev) =>
      prev.role === next.role && prev.signedIn === next.signedIn ? prev : next,
    )
  }, [])

  useChromeData(getCurrentUserChrome, onData, ROLE_TTL_MS)
  return <RoleContext.Provider value={chrome}>{children}</RoleContext.Provider>
}
