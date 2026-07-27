"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Ban, ChevronRight, ExternalLink, Info, Loader2, Play, Search, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { SaveButton } from "@/components/ui/save-button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { RunningStrip } from "@/components/settings/running-strip"
import { StatCard } from "@/components/settings/stat-card"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { useRefresh } from "@/lib/use-refresh"
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
  /** Total de obras ativas no catálogo — base do strip de cobertura. */
  catalogTotal: number
}

const byTitle = (a: WorkMissingComix, b: WorkMissingComix) => a.title.localeCompare(b.title)

/** Busca da obra no site da Comix (mesma URL que o resolver usa para descobrir candidatos). */
const comixSearchUrl = (title: string) => `https://comix.to/browse?q=${encodeURIComponent(title)}`

/**
 * Tooltip do "Como funciona" — renderizado ao lado do título "Cobertura" no
 * <summary> da página de settings (por isso é exportado e autocontido: traz o
 * próprio TooltipProvider). Guarda o comando e o pré-requisito de Chrome que
 * antes poluíam o corpo do painel.
 */
export function CoberturaInfoTooltip() {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Dentro do <summary>: impedir que o clique/Enter alterne o <details>.
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            aria-label="Como funciona a resolução de hids"
            className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-amber-600 dark:hover:text-amber-400"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-xs space-y-1.5 px-3 py-2 text-left">
          <p className="font-mono text-[11px]">npm run resolve-comix-hids</p>
          <p className="text-[11px] leading-relaxed opacity-80">
            Roda no servidor e exige Chrome/Chromium na máquina (dev: Chrome do sistema; produção:
            instalar Chromium + <span className="font-mono">CHROME_PATH</span>).
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Cor do pill de status conforme o estado do resolver. */
function statusTone(state: Status["state"]) {
  switch (state) {
    case "running":
      return { box: "border-amber-500/40 bg-amber-500/10", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" }
    case "done":
      return { box: "border-emerald-500/40 bg-emerald-500/10", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" }
    case "failed":
      return { box: "border-rose-500/40 bg-rose-500/10", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" }
    default:
      return { box: "border-border bg-muted/30", dot: "bg-muted-foreground/60", text: "text-foreground" }
  }
}

export function ResolveComixPanel({
  accent,
  initialStatus,
  initialMissing,
  initialAbsent,
  catalogTotal,
}: ResolveComixPanelProps) {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [missing, setMissing] = useState<WorkMissingComix[]>(initialMissing)
  const [absent, setAbsent] = useState<WorkMissingComix[]>(initialAbsent)
  const [starting, startTransition] = useTransition()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refresh = useRefresh()

  const running = status.state === "running"

  // "com hid Comix" é derivado — total menos as duas pontas — então o strip acompanha
  // salvar/marcar/restaurar sem uma segunda ida ao servidor.
  const ignored = absent.length
  const withHid = Math.max(0, catalogTotal - missing.length - ignored)
  const withHidPct = catalogTotal > 0 ? Math.round((withHid / catalogTotal) * 100) : 0

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

  // Vínculo manual salvo → sai de vez (resolvida). refresh() reconcilia o badge da
  // sidebar + pill da sub-nav (o contador local já cai sozinho): a pendência de Comix
  // alimenta getSettingsItemPending().comix, que é server-side e não escutava o bus —
  // por isso o badge só caía ao recarregar. Uso refresh() puro (re-busca a contagem
  // REAL) em vez de um delta otimista: contagem errada é justamente o que queremos evitar.
  const onSaved = (workId: string) => {
    setMissing((prev) => prev.filter((w) => w.id !== workId))
    refresh()
  }

  // "Não existe" → move de pendente pra ignorada (ignoradas não contam no badge).
  const onMarkedAbsent = (work: WorkMissingComix) => {
    setMissing((prev) => prev.filter((w) => w.id !== work.id))
    setAbsent((prev) => [...prev, work].sort(byTitle))
    refresh()
  }

  // "Restaurar" → volta de ignorada pra pendente (badge sobe de novo).
  const onRestored = (work: WorkMissingComix) => {
    setAbsent((prev) => prev.filter((w) => w.id !== work.id))
    setMissing((prev) => [...prev, work].sort(byTitle))
    refresh()
  }

  const stateLabel =
    status.state === "running"
      ? "Em execução…"
      : status.state === "done"
        ? "Concluído"
        : status.state === "failed"
          ? `Falhou${status.summary ? ` — ${status.summary}` : ""}`
          : "Nunca executado"

  const tone = statusTone(status.state)

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        {/* ── Botão do resolver ─────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Descobre o hid da Comix das obras que ainda não têm um e salva, pra que as reviews da
                Comix passem a funcionar pra elas.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <SaveButton
                type="button"
                onClick={handleStart}
                disabled={running || starting || missing.length === 0}
                disabledReason={
                  !running && !starting && missing.length === 0
                    ? "Todas as obras já têm hid da Comix (ou foram ignoradas)"
                    : undefined
                }
                className={ACCENT_BUTTON[accent]}
              >
                {running || starting ? <Loader2 className="animate-spin" /> : <Play />}
                {running ? "Em execução…" : starting ? "Iniciando…" : "Resolver hids da Comix"}
              </SaveButton>
              <LastRunHint iso={status.finishedAt ?? status.startedAt} label="Última execução" />
            </div>
          </div>

          {/* Nível B: enquanto roda (~10 min, em background), a faixa proeminente
              conta o tempo desde o início real — sobrevive a sair/voltar. */}
          <RunningStrip
            accent={accent}
            label="Resolvendo hids da Comix"
            running={running}
            startedAt={status.startedAt}
          />

          {/* Parado: o pill é o estado sticky (Concluído / Falhou / Nunca). */}
          {!running && (
            <div className={cn("inline-flex items-center gap-2.5 rounded-lg border px-3.5 py-2", tone.box)}>
              <span className={cn("size-2 rounded-full", tone.dot)} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <span className={cn("text-[13px] font-bold", tone.text)}>{stateLabel}</span>
            </div>
          )}

          {/* Cobertura — mesmo StatCard das pipelines. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="No catálogo" value={catalogTotal} hint="obras ativas" />
            <StatCard
              label="Com hid Comix"
              value={withHid}
              hint={`${withHidPct}% do catálogo`}
            />
            <StatCard label="Ignoradas" value={ignored} hint="não existem na Comix" />
          </div>

          {/* Log só sobrevive em falha — aí ele é o diagnóstico, não ruído. */}
          {status.state === "failed" && status.logTail && (
            <pre className="max-h-40 overflow-auto rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {status.logTail}
            </pre>
          )}
        </div>

        {/* ── Preenchimento manual ──────────────────────────────────── */}
        <div className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Preencher manualmente</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Como conta o badge"
                  className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-xs px-3 py-2 text-left text-[11px] leading-relaxed">
                O contador e o badge da sidebar contam só as pendentes de verdade — as ignoradas não
                pesam.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            Obras sem hid da Comix. Cole o hid (ex.: <span className="font-mono">003kd</span>) ou a URL
            da comix.to. Se a obra <strong className="font-medium text-foreground">não existe</strong> na
            Comix, marque{" "}
            <Ban className="inline size-3.5 align-text-bottom text-destructive" aria-label="não existe" />.
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
                  accent={accent}
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
        </div>
      </div>
    </TooltipProvider>
  )
}

function ManualRow({
  work,
  accent,
  onSaved,
  onMarkedAbsent,
}: {
  work: WorkMissingComix
  accent: SettingsAccent
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

      {/* Abrir a busca da Comix pra achar o hid da obra. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={comixSearchUrl(work.title)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Procurar na Comix"
            className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "text-muted-foreground")}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="top">Procurar na Comix</TooltipContent>
      </Tooltip>

      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save()
        }}
        placeholder="hid ou URL"
        disabled={pending}
        className="h-8 w-60 font-mono text-xs"
      />

      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={pending || !value.trim()}
        className={ACCENT_BUTTON[accent]}
      >
        {pending && busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={markAbsent}
            disabled={pending}
            aria-label="Não existe na Comix"
            className="text-muted-foreground hover:text-destructive"
          >
            {pending && busy === "absent" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Ban className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Não existe na Comix</TooltipContent>
      </Tooltip>
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
