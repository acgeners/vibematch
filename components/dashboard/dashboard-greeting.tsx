"use client"

import { useSyncExternalStore } from "react"

const noopSubscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

function computeGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bom dia"
  if (hour >= 12 && hour < 18) return "Boa tarde"
  return "Boa noite"
}

/**
 * Saudação por horário no topo do dashboard. O prefixo (Bom dia/tarde/noite)
 * usa a hora LOCAL do usuário — o dashboard pode ser pré-renderizado e o fuso
 * do servidor pode divergir do dele.
 *
 * `useSyncExternalStore` entrega `false` no SSR/hidratação e `true` no cliente,
 * então o servidor renderiza "Olá" (sem mismatch) e o cliente refina pro
 * horário certo. Mesmo padrão do `WorkTitleLink`.
 */
export function DashboardGreeting({ firstName }: { firstName?: string | null }) {
  const mounted = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot)
  const name = firstName?.trim()
  const greeting = mounted ? computeGreeting(new Date().getHours()) : "Olá"
  return (
    <>
      {greeting}
      {name ? `, ${name}` : ""} <span aria-hidden>👋</span>
    </>
  )
}
