"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Ban, ChevronRight, Loader2, Play, Search, Undo2 } from "lucide-react"
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
  markComixAbsent,
  unmarkComixAbsent,
} from "@/server/actions/comix-resolver"
import type { WorkMissingComix } from "@/server/queries/comix-coverage"

type Status = Awaited<ReturnType<typeof getComixResolverStatus>>

interface ResolveComixPanelProps {
  accent: SettingsAccent
  initialStatus: Status
  initialMissing: WorkMissingComix[]
  /** Obras já marcadas como inexistentes no Comix (lista "Ignoradas"). */
  initialAbsent: WorkMissingComix[]
}

const byTitle = (a: WorkMissingComix, b: WorkMissingComix) => a.title.localeCompare(b.title)

export function ResolveComixPanel({
  accent,
  initialStatus,
  initialMissing,
  initialAbsent,
}: ResolveComixPanelProps) {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [missing, setMissing] = useState<WorkMissingComix[]>(initialMissing)
  const [absent, setAbsent] = useState<WorkMissingComix[]>(initialAbsent)
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

  // Vínculo manual salvo → sai de vez (resolvida).
  const onSaved = (workId: string) => setMissing((prev) => prev.filter((w) => w.id !== workId))

  // "Não existe" → move de pendente pra ignorada.
  const onMarkedAbsent = (work: WorkMissingComix) => {
    setMissing((prev) => prev.filter((w) => w.id !== work.id))
    setAbsent((prev) => [...prev, work].sort(byTitle))
  }

  // "Restaurar" → volta de ignorada pra pendente.
  const onRestored = (work: WorkMissingComix) => {
    setAbsent((prev) => prev.filter((w) => w.id !== work.id))
    setMissing((prev) => [...prev, work].sort(byTitle))
  }

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
          da comix.to; o título é validado antes de salvar. Se a obra <strong className="font-medium text-foreground">não existe</strong> na
          Comix, marque pra ela parar de aparecer como pendente.
        </p>

        {missing.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {absent.length > 0
              ? "Nenhuma obra pendente de hid da Comix. 🎉"
              : "Todas as obras ativas já têm hid da Comix. 🎉"}
          </p>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-auto rounded-md border border-border p-2">
            {missing.map((work) => (
              <ManualRow
                key={work.id}
                work={work}
                onSaved={() => onSaved(work.id)}
                onMarkedAbsent={() => onMarkedAbsent(work)}
              />
            ))}
          </div>
        )}

        {/* ── Ignoradas (não existem na Comix) ────────────────────── */}
        {absent.length > 0 && (
          <details className="group/abs rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform group-open/abs:rotate-90" />
              Ignoradas — não existem na Comix ({absent.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {absent.map((work) => (
                <AbsentRow key={work.id} work={work} onRestored={() => onRestored(work)} />
              ))}
            </div>
          </details>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          O contador e o badge da sidebar contam só as pendentes de verdade — as ignoradas não pesam.
        </p>
      </div>
    </div>
  )
}

function ManualRow({
  work,
  onSaved,
  onMarkedAbsent,
}: {
  work: WorkMissingComix
  onSaved: () => void
  onMarkedAbsent: () => void
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState<null | "save" | "absent">(null)
  const [pending, startTransition] = useTransition()

  const save = () => {
    const hidOrUrl = value.trim()
    if (!hidOrUrl) return
    setBusy("save")
    startTransition(async () => {
      const res = await setComixHidManually({ workId: work.id, hidOrUrl })
      if (res.ok) {
        toast.success(`Comix vinculada: "${res.title}"`)
        onSaved()
      } else {
        toast.error(res.error ?? "Falha ao salvar.")
        setBusy(null)
      }
    })
  }

  const markAbsent = () => {
    setBusy("absent")
    startTransition(async () => {
      const res = await markComixAbsent(work.id)
      if (res.ok) {
        toast.success(`"${work.title}" marcada como inexistente na Comix.`)
        onMarkedAbsent()
      } else {
        toast.error(res.error ?? "Falha ao marcar.")
        setBusy(null)
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
        {pending && busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={markAbsent}
        disabled={pending}
        title="Marcar que a obra não existe na Comix"
        className="text-muted-foreground hover:text-foreground"
      >
        {pending && busy === "absent" ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
        Não existe
      </Button>
    </div>
  )
}

function AbsentRow({ work, onRestored }: { work: WorkMissingComix; onRestored: () => void }) {
  const [pending, startTransition] = useTransition()

  const restore = () => {
    startTransition(async () => {
      const res = await unmarkComixAbsent(work.id)
      if (res.ok) {
        toast.success(`"${work.title}" voltou pra pendentes.`)
        onRestored()
      } else {
        toast.error(res.error ?? "Falha ao restaurar.")
      }
    })
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={work.title}>
        {work.title}
      </span>
      <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        não existe
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={restore}
        disabled={pending}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Restaurar
      </Button>
    </div>
  )
}
