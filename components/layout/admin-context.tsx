"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { getCurrentUserIsAdmin } from "@/server/actions/admin"
import { useChromeData } from "@/lib/use-refresh"

// Stopgap multi-user: admin = o DONO do catálogo (deslogado / linha singleton).
// Usuário logado é read-only sobre o catálogo COMPARTILHADO. Este contexto leva o
// sinal `isAdmin` do servidor pro client, pra esconder os controles de mutação
// (favoritar/editar/status/add/curadoria) e a seção GERENCIAR. O bloqueio REAL é
// server-side (`ensureAdmin` nas actions); isto é só a camada de UI.
//
// Default `false` = fail-closed: não mostra controle de admin até o fetch CONFIRMAR
// que o usuário é admin. Assim o visitante anônimo (o comum em produção) não vê os
// controles de mutação piscarem; o dono logado tem um flash mínimo até confirmar.
// Re-sincroniza no `app:chrome-refresh` (login/logout mutam o chrome).
const AdminContext = createContext<boolean>(false)

/** True quando o usuário atual é o admin/dono do catálogo (pode mutar). */
export function useIsAdmin(): boolean {
  return useContext(AdminContext)
}

// TTL longo: o status admin só muda em login/logout, que já disparam refresh do
// chrome (força o re-fetch ignorando o TTL). O TTL só cobre a reconciliação por
// navegação — 5 min é folgado.
const ADMIN_TTL_MS = 300_000

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  useChromeData(getCurrentUserIsAdmin, setIsAdmin, ADMIN_TTL_MS)
  return <AdminContext.Provider value={isAdmin}>{children}</AdminContext.Provider>
}
