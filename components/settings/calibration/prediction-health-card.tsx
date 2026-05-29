import { CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { PredictionHealth } from "@/server/queries/calibration-guards"

type GuardStatus = "ok" | "warn" | "unknown"

function StatusIcon({ status }: { status: GuardStatus }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
  if (status === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
  return <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
}

function GuardRow({
  status,
  title,
  okLabel,
  message,
}: {
  status: GuardStatus
  title: string
  okLabel: string
  message: string | null
}) {
  return (
    <div className="flex items-start gap-2">
      <StatusIcon status={status} />
      <div className="min-w-0 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {" — "}
          {status === "warn" && message ? message : status === "unknown" ? "sem dados ainda" : okLabel}
        </span>
      </div>
    </div>
  )
}

const OVERALL = {
  ok: { label: "🟢 Operacional", cls: "text-emerald-600 dark:text-emerald-400" },
  warn: { label: "🟡 Atenção", cls: "text-amber-600 dark:text-amber-400" },
  alert: { label: "🔴 Degradado", cls: "text-rose-600 dark:text-rose-400" },
} as const

export function PredictionHealthCard({ health }: { health: PredictionHealth }) {
  const { overall, guard1, guard2, guard3, guard4 } = health
  return (
    <Card className="bg-card/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-bold">Saúde do sistema de previsão</CardTitle>
          <span className={cn("text-sm font-semibold", OVERALL[overall].cls)}>
            {OVERALL[overall].label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <GuardRow
          status={guard1.status}
          title="Modelo/prompt"
          okLabel="bias e avaliações recentes consistentes"
          message={guard1.message}
        />
        <GuardRow
          status={guard2.status}
          title="Cobertura de gênero"
          okLabel={`${guard2.lowCoverageWorks}/${guard2.unreadWorks} obras não-lidas com baixa cobertura`}
          message={guard2.message}
        />
        <GuardRow
          status={guard3.status}
          title="Amostras do offset"
          okLabel={`${guard3.attributesLowConfidence}/${guard3.totalWithSamples} atributos com poucas amostras`}
          message={guard3.message}
        />
        <GuardRow
          status={guard4.status}
          title="Estabilidade do MAE"
          okLabel={
            guard4.recentMae != null
              ? `MAE recente ${guard4.recentMae} vs baseline ${guard4.baselineMae}`
              : "histórico insuficiente"
          }
          message={guard4.message}
        />
      </CardContent>
    </Card>
  )
}
