"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Loader2, Play, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"
import {
  startComixResolver,
  getComixResolverStatus,
  setComixHidManually,
} from "@/server/actions/comix-resolver"
import type { WorkMissingComix } from "@/server/queries/comix-coverage"

type Status = Awaited<ReturnType<typeof getComixResolverStatus>>

interface ResolveComixPanelProps {
  accent: SettingsAccent
  initialStatus: Status
  initialMissing: WorkMissingComix[]
}

export function ResolveComixPanel({ accent, initialStatus, initialMissing }: ResolveComixPanelProps) {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [missing, setMissing] = useState<WorkMissingComix[]>(initialMissing)
  const [starting, startTransition] = useTransition()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const running = status.state === "running"

  // Polling do status enquanto o batch roda.
  useEffect(() => {
    if (running && !pollRef.current) {
      pollRef.current = setInterval(() => {
        void getComixResolverStatus().then(setStatus)
      }, 3000)
    }
    if (!running && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [running])

  const handleStart = () => {
    startTransition(async () => {
      const res = await startComixResolver()
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao iniciar o resolver.")
        return
      }
      toast.success("Resolver iniciado — leva ~10 min. Pode sair da página; rode de novo depois pra ver o resultado.")
      setStatus(await getComixResolverStatus())
    })
  }

  const onSaved = (workId: string) => setMissing((prev) => prev.filter((w) => w.id !== workId))

  const stateLabel =
    status.state === "running"
      ? "Em execução…"
      : status.state === "done"
        ? `Concluído${status.summary ? ` — ${status.summary}` : ""}`
        : status.state === "failed"
          ? `Falhou${status.summary ? ` — ${status.summary}` : ""}`
          : "Nunca executado"

  return (
    <div className="space-y-5">
      {/* ── Botão do resolver ─────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Descobre o hid da Comix das obras que ainda não têm um e salva, pra que as reviews da
              Comix passem a funcionar pra elas.
            </p>
            <p className="font-mono text-xs">npm run resolve-comix-hids</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Roda no servidor e exige Chrome/Chromium na máquina (dev: Chrome do sistema; produção:
              instalar Chromium + <span className="font-mono">CHROME_PATH</span>).
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button type="button" onClick={handleStart} disabled={running || starting} className={ACCENT_BUTTON[accent]}>
              {running || starting ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? "Em execução…" : starting ? "Iniciando…" : "Resolver hids da Comix"}
            </Button>
            <LastRunHint iso={status.finishedAt ?? status.startedAt} label="Última execução" />
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Status: </span>
          <span className={cn("font-medium", running && "text-amber-600 dark:text-amber-400")}>{stateLabel}</span>
        </div>

        {status.logTail && (
          <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {status.logTail}
          </pre>
        )}
      </div>

      {/* ── Preenchimento manual ──────────────────────────────────── */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Preencher manualmente ({missing.length})
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Obras sem hid da Comix. Cole o hid (ex.: <span className="font-mono">003kd</span>) ou a URL
          da comix.to; o título é validado antes de salvar.
        </p>

        {missing.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            Todas as obras ativas já têm hid da Comix. 🎉
          </p>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-auto rounded-md border border-border p-2">
            {missing.map((work) => (
              <ManualRow key={work.id} work={work} onSaved={() => onSaved(work.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ManualRow({ work, onSaved }: { work: WorkMissingComix; onSaved: () => void }) {
  const [value, setValue] = useState("")
  const [pending, startTransition] = useTransition()

  const save = () => {
    const hidOrUrl = value.trim()
    if (!hidOrUrl) return
    startTransition(async () => {
      const res = await setComixHidManually({ workId: work.id, hidOrUrl })
      if (res.ok) {
        toast.success(`Comix vinculada: "${res.title}"`)
        onSaved()
      } else {
        toast.error(res.error ?? "Falha ao salvar.")
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm" title={work.title}>
        {work.title}
      </span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save()
        }}
        placeholder="hid ou URL"
        disabled={pending}
        className="h-8 w-40 text-xs"
      />
      <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending || !value.trim()}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
      </Button>
    </div>
  )
}
