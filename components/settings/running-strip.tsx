"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"

// Nível B do padrão de loading (ações longas — Pipeline/Lote): um estado de
// execução PROEMINENTE e PERSISTENTE. Um spinner discreto some quando o usuário
// desvia o olhar; aqui o contador que ANDA prova que ainda está rodando, e a
// faixa full-width lê "trabalhando" de longe. Barra indeterminada (as ações de
// settings não reportam %; quando reportarem, trocar por barra determinada
// "X/Y"). Reaproveita `.task-indeterminate-bar` do globals.css (mesma barra do
// indicador de tarefas em segundo plano).

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function RunningStrip({
  accent,
  label,
  running,
  startedAt,
}: {
  accent: SettingsAccent
  /** Gerúndio da ação, sem reticências (ex.: "Recalibrando as notas"). */
  label: string
  running: boolean
  /**
   * Início real da execução (ISO ou epoch ms). Passe quando o trabalho é
   * rastreado por polling e pode já estar rodando ao montar (ex.: o resolver da
   * Comix, que sobrevive à navegação) — o contador conta a partir daí, não do
   * mount. Omita para ações in-page, que começam agora.
   */
  startedAt?: string | number | null
}) {
  // Monta o miolo só quando roda: o contador reinicia do zero a cada execução
  // (sem reset via setState no effect) e desmonta ao terminar.
  if (!running) return null
  return <RunningStripInner accent={accent} label={label} startedAt={startedAt} />
}

function RunningStripInner({
  accent,
  label,
  startedAt,
}: {
  accent: SettingsAccent
  label: string
  startedAt?: string | number | null
}) {
  // Inicia em 0 (determinístico → sem mismatch de hidratação); o 1º tick (≤250ms)
  // corrige pro elapsed real quando `startedAt` é passado.
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const start = startedAt != null ? new Date(startedAt).getTime() : Date.now()
    const id = setInterval(() => setMs(Math.max(0, Date.now() - start)), 250)
    return () => clearInterval(id)
  }, [startedAt])

  const s = ACCENT_STYLES[accent]
  return (
    <div role="status" className={cn("rounded-lg p-3 ring-1", s.cardBg, s.ring)}>
      <div className="flex items-center gap-2.5">
        <Loader2 className={cn("size-4 shrink-0 animate-spin", s.iconText)} aria-hidden />
        <span className="text-sm font-medium text-foreground">{label}…</span>
        <span
          className="ml-auto font-mono text-xs tabular-nums text-muted-foreground"
          aria-hidden
        >
          rodando · {formatElapsed(ms)}
        </span>
      </div>
      {/* `iconText` no track → o bar (`bg-current`) herda a cor do accent. */}
      <div className={cn("relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted/50", s.iconText)}>
        <span className="task-indeterminate-bar bg-current" aria-hidden />
      </div>
    </div>
  )
}
