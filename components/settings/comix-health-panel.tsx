"use client"

import { useState, useTransition } from "react"
import { Activity, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import type { SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"
import { checkComixHealth } from "@/server/actions/comix-resolver"

// Deriva o shape do retorno da action (arquivo "use server" não exporta tipos).
type ComixHealthResult = Awaited<ReturnType<typeof checkComixHealth>>

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export function ComixHealthPanel({ accent }: { accent: SettingsAccent }) {
  const [result, setResult] = useState<ComixHealthResult | null>(null)
  const [pending, startTransition] = useTransition()

  const run = () => {
    startTransition(async () => {
      try {
        const res = await checkComixHealth()
        setResult(res)
        if (res.checks.every((c) => c.ok)) {
          toast.success("Comix OK — todas as chamadas funcionando.")
        } else {
          toast.error("Comix com problemas — veja o diagnóstico abaixo.")
        }
      } catch {
        toast.error("Falha ao rodar o diagnóstico.")
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Roda um canário (hid fixo) por todas as superfícies da Comix — FlareSolverr, detalhe
          (SSR), reviews (threads) e imagem (CDN) — sem precisar abrir uma obra. A 1ª chamada paga o
          solve frio do Cloudflare (~11s) e aquece a sessão; depois fica rápido.
        </p>
        <div className="flex flex-col items-end gap-1">
          <Button type="button" onClick={run} disabled={pending} className={ACCENT_BUTTON[accent]}>
            {pending ? <Loader2 className="animate-spin" /> : <Activity />}
            {pending ? "Testando…" : "Testar agora"}
          </Button>
          {result && <LastRunHint iso={result.checkedAt} label="Último teste" />}
        </div>
      </div>

      {result && (
        <div className="divide-y divide-border/60 rounded-md border border-border">
          {result.checks.map((c) => (
            <div key={c.label} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span
                className={cn("size-2 shrink-0 rounded-full", c.ok ? "bg-emerald-500" : "bg-rose-500")}
                aria-hidden
              />
              <span className="w-32 shrink-0 font-medium text-foreground">{c.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={c.detail}>
                {c.detail}
              </span>
              {c.ms != null && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatMs(c.ms)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
