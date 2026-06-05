"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Crown, Check, Lock, Loader2 } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PAID_CAPABILITIES, planAllows } from "@/lib/plans/capabilities"
import type { Capability, UserPlan } from "@/lib/plans/capabilities"
import { cancelPlan, reactivatePlan } from "@/server/actions/account"
import { cn } from "@/lib/utils"

interface PlanCardProps {
  plan: UserPlan
}

export function PlanCard({ plan }: PlanCardProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const isPaid = plan === "paid"
  const caps = Object.entries(PAID_CAPABILITIES) as [Capability, string][]

  const handleCancel = async () => {
    setConfirmOpen(false)
    setPending(true)
    const result = await cancelPlan()
    setPending(false)
    if (result.error) {
      toast.error(`Erro ao cancelar: ${result.error}`)
      return
    }
    toast.success("Plano cancelado. Você está no Free.")
    router.refresh()
  }

  const handleReactivate = async () => {
    setPending(true)
    const result = await reactivatePlan()
    setPending(false)
    if (result.error) {
      toast.error(`Erro ao reativar: ${result.error}`)
      return
    }
    toast.success("Plano Pago reativado.")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="h-4 w-4 text-amber-500" />
          Plano
        </CardTitle>
        <CardDescription className="text-xs">
          O que cada recurso de IA libera. {isPaid ? "Cancele quando quiser." : "Reative pra voltar ao acesso total."}
        </CardDescription>
        <CardAction>
          <Badge
            variant={isPaid ? "default" : "outline"}
            className={cn(!isPaid && "text-muted-foreground")}
          >
            {isPaid ? "Pago" : "Free"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {caps.map(([cap, desc]) => {
            const allowed = planAllows(plan, cap)
            return (
              <div key={cap} className="flex items-start gap-2 text-sm">
                {allowed ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                )}
                <span className={cn(allowed ? "text-foreground" : "text-muted-foreground")}>
                  {desc}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-border/50 pt-3">
          {isPaid ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
            >
              {pending && <Loader2 className="animate-spin" />}
              Cancelar plano
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={handleReactivate}>
              {pending ? <Loader2 className="animate-spin" /> : <Crown />}
              Reativar plano Pago
            </Button>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancelar o plano Pago?"
        description="Você volta pro Free e perde as features de IA sob demanda (re-rank, deep dive, mood, chat) e a previsão rica. Dá pra reativar a qualquer momento aqui mesmo."
        confirmText="Cancelar plano"
        cancelText="Voltar"
        onConfirm={handleCancel}
      />
    </Card>
  )
}
