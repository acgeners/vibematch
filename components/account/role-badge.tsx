import { ROLE_LABELS } from "@/lib/plans/roles"
import type { Role } from "@/lib/plans/roles"
import { cn } from "@/lib/utils"

// Cor com significado: âmbar = autoridade sobre o catálogo; índigo = plano pago (mesma
// família dos acentos de IA do app); cinza = leitura. O Leitor é neutro DE PROPÓSITO —
// é o papel da maioria e não deve parecer punição.
//
// ⚠️ `ring`, não `border-<cor>`: `globals.css` tem um `* { border-color }` fora de
// @layer, que no Tailwind v4 vence QUALQUER utility de cor de borda. Com `border-amber`
// os três badges sairiam com a mesma borda cinza.
const ROLE_STYLES: Record<Role, string> = {
  curador: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  assinante: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
  leitor: "bg-muted text-muted-foreground ring-border",
}

export function RoleBadge({
  role,
  className,
  size = "default",
}: {
  role: Role
  className?: string
  size?: "default" | "sm"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold ring-1",
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]",
        ROLE_STYLES[role],
        className,
      )}
    >
      <span className="size-1 rounded-full bg-current" aria-hidden />
      {ROLE_LABELS[role]}
    </span>
  )
}
