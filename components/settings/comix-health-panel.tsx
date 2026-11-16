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
import { refreshChrome } from "@/lib/chrome-refresh"

// Deriva o shape do retorno da action (arquivo "use server" não exporta tipos).
type ComixHealthResult = Awaited<ReturnType<typeof checkComixHealth>>
type ComixCheckKey = ComixHealthResult["checks"][number]["key"]

/**
 * O que fazer quando cada superfície falha. `Record` sobre a chave: superfície nova no
 * canário não compila sem dizer o que fazer com ela.
 */
const FAILURE_HINT: Record<ComixCheckKey, string> = {
  flaresolverr: "Só informativo: a Comix não depende dele.",
  detail:
    "A página do canário não abriu. Abra comix.to no navegador: se abrir, a Comix está barrando este servidor — ligue o Docker (FlareSolverr) e teste de novo; se não abrir, ela está fora do ar.",
  reviews:
    "Os comentários vêm de outra rota da Comix. Enquanto falhar, as obras seguem com as reviews já guardadas e as novas não chegam.",
  image:
    "A capa do canário não carregou. As capas da Comix caem nas de outras fontes; se o resto passou, não há o que fazer.",
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export function ComixHealthPanel({
  accent,
  available,
}: {
  accent: SettingsAccent
  /**
   * Este servidor tem o contorno do Cloudflare (`hasCfBypassConfigured`)? Sem ele o teste fica
   * desabilitado: a Comix barra o servidor do Fly (403), e o canário reprovado de lá gravaria
   * no banco "Comix fora" também para o Mac.
   */
  available: boolean
}) {
  const [result, setResult] = useState<ComixHealthResult | null>(null)
  const [pending, startTransition] = useTransition()

  const run = () => {
    startTransition(async () => {
      try {
        const res = await checkComixHealth()
        setResult(res)
        // O canário moveu o estado do gate (sucesso limpa "fora"/falha o re-arma).
        // Re-busca o chrome pra o indicador "Comix fora" na sidebar refletir já.
        refreshChrome()
        const failed = res.checks.filter((c) => !c.ok)
        if (failed.length === 0) {
          toast.success("Comix OK — todas as chamadas funcionando.")
        } else {
          // O toast NOMEIA o que falhou. Ele dizia "veja o diagnóstico abaixo", mas mora no
          // canto da tela, longe do painel, e não havia nada "abaixo" dele.
          toast.error(`Comix com problemas: ${failed.map((c) => c.label).join(", ")}`, {
            description: failed[0].detail,
          })
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
          Um canário (hid fixo) checa{" "}
          <strong className="font-semibold text-foreground">detalhe</strong>,{" "}
          <strong className="font-semibold text-foreground">reviews</strong> e{" "}
          <strong className="font-semibold text-foreground">imagem</strong> — sem abrir nenhuma obra.
        </p>
        <div className="flex flex-col items-end gap-1">
          <Button type="button" onClick={run} disabled={pending || !available} className={ACCENT_BUTTON[accent]}>
            {pending ? <Loader2 className="animate-spin" /> : <Activity />}
            {pending ? "Testando…" : "Testar agora"}
          </Button>
          {!available && (
            <span className="text-[11px] text-muted-foreground">Indisponível neste servidor: rode no localhost.</span>
          )}
          {result && <LastRunHint iso={result.checkedAt} label="Último teste" />}
        </div>
      </div>

      {result && (
        <div className="divide-y divide-border/60 rounded-md border border-border">
          {result.checks.map((c) => (
            <div key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.ok ? "bg-emerald-500" : "bg-rose-500")}
                aria-hidden
              />
              <span className="w-32 shrink-0 font-medium text-foreground">{c.label}</span>
              <div className="min-w-0 flex-1">
                {/* A falha mostra o texto INTEIRO e o que fazer: cortada numa linha, com o resto só
                    no tooltip, ela não era lida como diagnóstico. O sucesso segue numa linha. */}
                <p className={cn("text-muted-foreground", c.ok ? "truncate" : "break-words text-foreground")} title={c.detail}>
                  {c.detail}
                </p>
                {!c.ok && <p className="mt-0.5 text-xs text-muted-foreground">{FAILURE_HINT[c.key]}</p>}
              </div>
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
