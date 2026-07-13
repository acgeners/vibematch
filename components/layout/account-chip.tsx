"use client"

/* eslint-disable @next/next/no-img-element -- avatar pequeno com URL do usuário (própria ou colada) + fallback próprio; next/image não cabe (sem images config). */

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserCircle } from "lucide-react"
import { getAccountSummary } from "@/server/actions/account"
import type { AccountSummary } from "@/server/actions/account"
import { useChromeData } from "@/lib/use-refresh"
import { RoleBadge } from "@/components/conta/role-badge"
import { cn } from "@/lib/utils"

/**
 * Chip de conta no rodapé da sidebar: avatar + nome + plano, linkando pra /conta.
 * Busca o resumo no client (como os badges) e re-busca a cada navegação pra
 * refletir edições feitas em /conta. Falha silenciosa → cai pro placeholder.
 */
export function AccountChip({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname()
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [imgError, setImgError] = useState(false)

  // Re-busca o resumo da conta a cada navegação e quando uma mutação atualiza o
  // chrome (ex.: editar perfil/plano em /conta). Coalescing/lifecycle no hook.
  useChromeData(getAccountSummary, (s) => {
    setSummary(s)
    setImgError(false)
  })

  const active = pathname === "/conta" || pathname.startsWith("/conta/")
  const name = summary?.displayName?.trim() || "Minha conta"
  const showImg = Boolean(summary?.avatarUrl) && !imgError

  return (
    <Link
      href="/conta"
      aria-current={active ? "page" : undefined}
      title={compact ? name : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
        compact && "justify-center gap-0 px-0",
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
      {!compact && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-sidebar-foreground">{name}</span>
          {/* O papel é o único lugar SEMPRE visível — sem isto ele fica invisível até
              alguém abrir /conta. Enquanto o resumo não chega, não chuta um papel. */}
          <span className="mt-0.5 block">
            {summary ? (
              <RoleBadge role={summary.role} size="sm" />
            ) : (
              <span className="block truncate text-[11px] font-medium text-muted-foreground/70">
                v1 · catálogo pessoal
              </span>
            )}
          </span>
        </span>
      )}
    </Link>
  )
}
