import { Settings } from "lucide-react"
import { Header } from "@/components/layout/header"

// Espelha o OVERVIEW do console (grid de cards agrupado) enquanto a rota carrega.
export default function SettingsLoading() {
  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Configurações"
        description="Console de operação: jobs do pipeline, curadoria e manutenção"
        icon={<Settings />}
      />
      <div className="space-y-5">
        {[3, 2].map((count, gi) => (
          <div key={gi} className="space-y-2.5">
            <div className="h-3 w-44 animate-pulse rounded bg-muted/70" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: count }).map((_, ci) => (
                <div
                  key={ci}
                  className="min-h-[128px] rounded-2xl border border-border/70 bg-card/55 p-4"
                >
                  <div className="size-11 animate-pulse rounded-xl bg-muted" />
                  <div className="mt-3 h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted/60" />
                  <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-muted/60" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
