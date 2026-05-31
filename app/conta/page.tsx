import { UserCircle, Crown, Check, Lock } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getCurrentUserId, getCurrentPlan } from "@/server/queries/current-user"
import { PAID_CAPABILITIES, planAllows } from "@/lib/plans/capabilities"
import type { Capability } from "@/lib/plans/capabilities"
import { cn } from "@/lib/utils"

// Plano (getCurrentPlan) pode mudar em runtime — limita a staleness do snapshot.
export const revalidate = 60

export default async function ContaPage() {
  const [userId, plan] = await Promise.all([getCurrentUserId(), getCurrentPlan()])
  const isPaid = plan === "paid"
  const caps = Object.entries(PAID_CAPABILITIES) as [Capability, string][]

  return (
    <div className="space-y-4">
      {/* Identidade — scaffold até o multi-user / auth entrar. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identidade</CardTitle>
          <CardDescription className="text-xs">
            Login, nome e avatar chegam com o multi-user — hoje o app roda como usuário único.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20 [&_svg]:size-7">
              <UserCircle />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Usuário{" "}
                <span className="font-normal text-muted-foreground">(perfil público em breve)</span>
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                <span className="text-muted-foreground/70">user id:</span> {userId}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plano — somente leitura; upgrade/billing entram depois. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="h-4 w-4 text-amber-500" />
            Plano
          </CardTitle>
          <CardDescription className="text-xs">
            O que cada recurso de IA libera. Fluxo de upgrade chega com o billing.
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
        <CardContent className="space-y-2">
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
        </CardContent>
      </Card>
    </div>
  )
}
