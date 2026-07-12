"use client"

import { useState, useTransition } from "react"
import { Activity, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import type { SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"
import { checkProtectedSourcesHealth } from "@/server/actions/source-health"

// Deriva o shape do retorno da action (arquivo "use server" não exporta tipos).
type SourcesHealthResult = Awaited<ReturnType<typeof checkProtectedSourcesHealth>>

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/**
 * Canário das fontes que só passam via bypass do Cloudflare (Mangago, AnimePlanet).
 * Irmão do `ComixHealthPanel`, com uma inversão deliberada: lá o FlareSolverr é linha
 * informativa e nunca reprova (a Comix não depende dele); aqui ele é DEPENDÊNCIA — se cair,
 * estas fontes somem, e o painel fica vermelho porque é isso que acontece com os dados.
 */
export function ProtectedSourcesHealthPanel({ accent }: { accent: SettingsAccent }) {
  const [result, setResult] = useState<SourcesHealthResult | null>(null)
  const [pending, startTransition] = useTransition()

  const run = () => {
    startTransition(async () => {
      try {
        const res = await checkProtectedSourcesHealth()
        setResult(res)
        // Linhas informativas (o sidecar) não entram no veredito — só o desfecho das fontes.
        const decisive = res.checks.filter((c) => !c.informational)
        if (decisive.every((c) => c.ok)) {
          toast.success("Mangago e AnimePlanet estão puxando dados.")
        } else {
          toast.error("Fontes atrás do Cloudflare com problema — veja o diagnóstico.")
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao rodar o diagnóstico.")
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Roda um canário (obra fixa) em cada fonte que só passa via bypass do Cloudflare.
          Diferente da Comix, estas <strong className="font-semibold text-foreground">dependem</strong> dele:
          se o bypass cair, elas somem — e a obra passa a mostrar “fonte fora do ar”. A pergunta
          aqui é se os dados chegam agora, não se o container respira.
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
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  c.informational ? "bg-muted-foreground/50" : c.ok ? "bg-emerald-500" : "bg-rose-500"
                )}
                aria-hidden
              />
              <span className="w-40 shrink-0 font-medium text-foreground">{c.label}</span>
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
