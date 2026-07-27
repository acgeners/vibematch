"use client"

import { useRouter } from "next/navigation"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** Pendência de um artefato gerado por IA — alimenta a trava do recálculo/calibração. */
export interface AiPendingItem {
  label: string
  count: number
  /** URL da seção correspondente (ex.: "/settings?g=ia#card-embeddings"). */
  href: string
}

interface AiPendingGuardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Já filtrados para count > 0. */
  items: AiPendingItem[]
  /** Chamado quando o usuário decide seguir mesmo assim. */
  onProceed: () => void
  title?: string
  description?: string
  proceedLabel?: string
  cancelLabel?: string
  /** Estilização do botão de prosseguir (accent da seção). */
  proceedClassName?: string
}

/**
 * Trava reutilizável: avisa que há artefatos gerados por IA pendentes antes de
 * uma ação que os consome como sinal (calibração / recálculo de notas). O
 * usuário decide seguir mesmo assim ou resolver as pendências antes. Cada item
 * é um link que fecha o popup e leva à seção correspondente; o botão "Resolver
 * pendências antes" leva direto ao /settings na primeira pendência da lista
 * (todas moram no mesmo grupo "Gerado por IA", então as demais ficam à vista).
 */
export function AiPendingGuardDialog({
  open,
  onOpenChange,
  items,
  onProceed,
  title = "Há artefatos de IA pendentes",
  description = "Esta ação usa os artefatos gerados por IA (embeddings, etc.) como sinal. Rodar agora usa dados possivelmente desatualizados — o resultado pode sair pior. Resolva as pendências primeiro ou siga mesmo assim.",
  proceedLabel = "Seguir mesmo assim",
  cancelLabel = "Resolver pendências antes",
  proceedClassName,
}: AiPendingGuardDialogProps) {
  const router = useRouter()
  // "Resolver pendências antes" abre o /settings na primeira pendência (o popup
  // só abre com items.length > 0, então sempre há um alvo).
  const resolveHref = items[0]?.href

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          {items.map((item) => (
            <li key={item.href} className="flex items-center justify-between gap-3">
              <a
                href={item.href}
                onClick={() => onOpenChange(false)}
                className="text-foreground hover:underline"
              >
                {item.label}
              </a>
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-300">
                {item.count} pendente{item.count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              if (resolveHref) router.push(resolveHref)
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onProceed} className={proceedClassName}>
            {proceedLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
