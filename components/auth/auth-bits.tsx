import type { ReactNode } from "react"

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export function PlanNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-accent/40 px-3.5 py-2.5 text-[12.5px] leading-snug text-accent-foreground">
      <span className="mt-px text-[15px] leading-none text-primary">◆</span>
      <span>
        Você começa no <b>plano Free</b>: catálogo completo e Nota Prevista. As ações de IA
        personalizadas ficam no plano Pago — dá pra mudar quando quiser.
      </span>
    </div>
  )
}
