"use client"

/* eslint-disable @next/next/no-img-element -- avatar pequeno com URL do usuário (própria ou colada) + fallback próprio; next/image não cabe (sem images config). */

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserCircle } from "lucide-react"
import { getAccountSummary } from "@/server/actions/account"
import type { AccountSummary } from "@/server/actions/account"
import { cn } from "@/lib/utils"

/**
 * Chip de conta no rodapé da sidebar: avatar + nome + plano, linkando pra /conta.
 * Busca o resumo no client (como os badges) e re-busca a cada navegação pra
 * refletir edições feitas em /conta. Falha silenciosa → cai pro placeholder.
 */
export function AccountChip() {
  const pathname = usePathname()
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAccountSummary()
      .then((s) => {
        if (!cancelled) {
          setSummary(s)
          setImgError(false)
        }
      })
      .catch(() => {
        /* mantém o estado atual em caso de falha */
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  const active = pathname === "/conta" || pathname.startsWith("/conta/")
  const name = summary?.displayName?.trim() || "Minha conta"
  const isPaid = summary?.plan === "paid"
  const showImg = Boolean(summary?.avatarUrl) && !imgError

  return (
    <Link
      href="/conta"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
        active ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent/80",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20 [&_svg]:size-5">
        {showImg ? (
          <img
            src={summary!.avatarUrl!}
            alt=""
            className="size-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <UserCircle />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-sidebar-foreground">{name}</span>
        <span
          className={cn(
            "block truncate text-[10px] font-medium",
            summary ? (isPaid ? "text-primary/80" : "text-muted-foreground/70") : "text-muted-foreground/70",
          )}
        >
          {summary ? (isPaid ? "Plano Pago" : "Plano Free") : "v1 · catálogo pessoal"}
        </span>
      </span>
    </Link>
  )
}
