"use client"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { badgeVariants } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatRelativeDate, formatFullDateTime } from "@/lib/date-utils"

interface ProfileStatusBadgeProps {
  /** Versão do perfil usado na execução. */
  version: number
  /** Data de geração do perfil usado (ISO). */
  createdAt: string
  /**
   * Quantas versões o perfil usado está atrás do atual. `null` quando não há
   * perfil atual pra comparar; ≤0 = atual; 1 = uma atrás; >1 = mais de uma.
   */
  versionsBehind: number | null
  /** Prefixo opcional dentro do badge (ex.: "Perfil considerado:"). */
  label?: string
  /** Sem a casca do badge (só bolinha + texto) — pra usar como valor inline. */
  bare?: boolean
}

type Tone = "current" | "one" | "many" | "unknown"

function toneOf(versionsBehind: number | null): Tone {
  if (versionsBehind == null) return "unknown"
  if (versionsBehind <= 0) return "current"
  if (versionsBehind === 1) return "one"
  return "many"
}

const DOT_CLASS: Record<Tone, string> = {
  current: "bg-emerald-500",
  one: "bg-amber-500",
  many: "bg-rose-500",
  unknown: "bg-muted-foreground/50",
}

const TEXT_CLASS: Record<Tone, string> = {
  current: "text-emerald-600 dark:text-emerald-300",
  one: "text-amber-600 dark:text-amber-300",
  many: "text-rose-600 dark:text-rose-300",
  unknown: "text-muted-foreground",
}

export function ProfileStatusBadge({ version, createdAt, versionsBehind, label, bare }: ProfileStatusBadgeProps) {
  const tone = toneOf(versionsBehind)
  const statusLabel =
    tone === "current"
      ? "Atual"
      : tone === "one"
        ? "1 versão atrás"
        : tone === "many"
          ? `${versionsBehind} versões atrás`
          : "Usado"

  const explanation =
    tone === "current"
      ? "É o mesmo perfil de gosto de agora — os resultados refletem seu gosto atual."
      : tone === "one"
        ? "Seu perfil de gosto foi atualizado 1 vez desde então; os resultados podem divergir um pouco do seu gosto atual."
        : tone === "many"
          ? `Seu perfil de gosto foi atualizado ${versionsBehind} vezes desde então; os resultados podem não refletir mais seu gosto atual.`
          : "Não foi possível comparar com o perfil atual."

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `bare` = só bolinha + texto (valor inline); senão, mesmo formato dos outros badges (outline). */}
          <span
            className={cn(
              "cursor-help items-center gap-1.5",
              bare ? "inline-flex" : badgeVariants({ variant: "outline" }),
            )}
          >
            {label && <span className="font-normal text-muted-foreground">{label}</span>}
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} />
            <span className={TEXT_CLASS[tone]}>{statusLabel}</span>
            <span className="font-normal text-muted-foreground">· {formatRelativeDate(createdAt)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px] space-y-1.5">
          <p className="text-xs font-semibold">
            Perfil de gosto v{version} · {formatFullDateTime(createdAt)}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
