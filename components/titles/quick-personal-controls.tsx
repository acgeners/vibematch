"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Check, ChevronDown, Loader2, Minus, Plus } from "lucide-react"
import { toast } from "sonner"

import { useRefresh } from "@/lib/use-refresh"
import { cn, readingProgressPercent } from "@/lib/utils"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkStatusGate } from "@/components/titles/work-status-gate"
import { setReadingStatusForWorks, setChaptersRead } from "@/server/actions/works"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { isTerminalPersonalStatus } from "@/lib/constants/status-lookups"
import { PERSONAL_STATUSES } from "@/types/domain"
import type { WorkStatusValues } from "@/lib/validations/work.schema"

/**
 * Controles rápidos da faixa de stats da página da obra: trocar o status de leitura, os
 * capítulos lidos e o Interesse ♥ sem abrir "Meu Status" — exceto quando o próprio atalho
 * decide que vale a pena abrir (ver `GATE_THRESHOLD_PCT` abaixo).
 *
 * A faixa é PERSISTENTE (fica fora do `<TabsContent>`), então os atalhos valem nas 5
 * abas — não só na Visão Geral.
 *
 * ⚠️ Estes campos vão por caminhos DIFERENTES no servidor, e é de propósito:
 *  - status    → `setReadingStatusForWorks` (só `personal_status_id`, sem tocar em capítulos,
 *                notas ou observações — o form completo continua sendo o lugar disso);
 *  - capítulos → `setChaptersRead` (só `chapters_read` + `last_read_at` quando cresce — a
 *                mesma action do stepper de /leitura, sem promover status);
 *  - ♥         → `setSynopsisQualityAction`, que é feature do Ridge e marca recálculo pendente.
 * Todos usam o MESMO gate (`ensureReadingStateWriter`): dado pessoal, qualquer usuário
 * logado. O que é restrito é PREVER o interesse por IA, não declará-lo.
 *
 * Gate pro diálogo "Meu Status" (`useWorkStatusGate`): status terminal (Finished/Dropped,
 * `isTerminalPersonalStatus`) ou capítulos lidos cruzando `GATE_THRESHOLD_PCT` do total abrem
 * o diálogo sozinhos, com os valores que acabaram de mudar — pra puxar quem "formou opinião"
 * de leitura pra avaliação completa (nota, atributos, "Como foi pra você"), sem exigir que ela
 * ache o botão "Status" por conta própria.
 */
const GATE_THRESHOLD_PCT = 20

/** Mesmo layout das demais células da faixa — mantido em sincronia com app/titles/[id]/page.tsx. */
const CELL_CLASS = "flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5"
const LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"

const STATUS_INFO_BY_NAME = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info]),
)

export interface QuickChaptersCellProps {
  workId: string
  /** `works.total_chapters` — curadoria, não editável aqui. */
  totalChapters: number | null
  /** `chapters_read` de quem está vendo (Fatia 1: mistura dono/leitor conforme a sessão). */
  chaptersRead: number | null
  /** false ⇒ visitante anônimo ou sem sessão: mostra o texto estático, sem afordância de clique. */
  canEdit: boolean
}

export function QuickChaptersCell({
  workId,
  totalChapters,
  chaptersRead,
  canEdit,
}: QuickChaptersCellProps) {
  const { requestOpen } = useWorkStatusGate()
  const [, startTransition] = useTransition()
  const [read, setRead] = useState(chaptersRead ?? 0)
  const [syncedProp, setSyncedProp] = useState(chaptersRead)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mesmo padrão "adjust during render" do QuickStatusCell — ver o comentário lá.
  if (chaptersRead !== syncedProp) {
    setSyncedProp(chaptersRead)
    setRead(chaptersRead ?? 0)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (!canEdit) {
    const total = totalChapters != null && totalChapters > 0 ? totalChapters : null
    const readDisplay = chaptersRead != null && chaptersRead > 0 ? chaptersRead : null
    const text =
      readDisplay != null && total != null
        ? `${readDisplay} / ${total} capítulos`
        : total != null
          ? `${total} capítulos`
          : readDisplay != null
            ? `${readDisplay} capítulos lidos`
            : null
    if (!text) return null
    return (
      <div className={CELL_CLASS}>
        <span className={LABEL_CLASS}>Capítulos</span>
        <span className="text-sm font-mono font-semibold text-foreground">{text}</span>
      </div>
    )
  }

  const persist = (value: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await setChaptersRead(workId, value)
        if (res && "error" in res && res.error) {
          toast.error("Não salvou os capítulos", { description: res.error })
          setRead(chaptersRead ?? 0) // reverte pro persistido
        }
      })
    }, 500)
  }

  const bump = (delta: number) => {
    const previous = read
    const next = Math.max(0, totalChapters ? Math.min(totalChapters, previous + delta) : previous + delta)
    if (next === previous) return
    setRead(next)
    persist(next)

    // Cruzou o limiar (leitura já formou opinião) → abre "Meu Status" com o valor novo,
    // sem esperar o revalidate. Só na subida — reduzir (corrigir um número) não reabre.
    if (delta > 0 && totalChapters && totalChapters > 0) {
      const prevPct = (previous / totalChapters) * 100
      const nextPct = (next / totalChapters) * 100
      if (prevPct <= GATE_THRESHOLD_PCT && nextPct > GATE_THRESHOLD_PCT) {
        requestOpen({ chapters_read: next })
      }
    }
  }

  const pct = totalChapters && totalChapters > 0 ? readingProgressPercent(read, totalChapters) : null

  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Capítulos</span>
      <Popover>
        <PopoverTrigger
          className="group -mx-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-foreground/5"
          aria-label="Editar capítulos lidos"
          title="Editar capítulos lidos"
        >
          <span className="font-mono text-sm font-semibold text-foreground">
            {totalChapters ? `${read} / ${totalChapters}` : read}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </PopoverTrigger>
        <PopoverContent align="center" className="w-60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Capítulos lidos
          </p>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 items-center rounded-lg border border-border/80">
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={read <= 0}
                aria-label="Diminuir capítulos lidos"
                className="grid h-8 w-7 place-items-center rounded-l-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="min-w-9 px-1 text-center font-mono text-base font-bold leading-none">
                {read}
              </span>
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={totalChapters != null && read >= totalChapters}
                aria-label="Aumentar capítulos lidos"
                className="grid h-8 w-7 place-items-center rounded-r-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {totalChapters ? (
              <>
                <span className="font-mono text-sm text-muted-foreground">/ {totalChapters}</span>
                <span className="ml-auto font-mono text-xs font-bold text-primary">{pct}%</span>
              </>
            ) : null}
          </div>
          {totalChapters ? (
            <>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                />
              </div>
              <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[11px] leading-snug text-muted-foreground">
                Passar de {GATE_THRESHOLD_PCT}% dos capítulos abre <b>Meu Status</b> automaticamente pra
                completar a avaliação.
              </p>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export interface QuickStatusCellProps {
  workId: string
  /** Status atual (`works.personal_status_id`), ou null quando a obra nunca foi tocada. */
  statusId: number | null
  /** false ⇒ visitante anônimo: mostra o badge estático, sem afordância de clique. */
  canEdit: boolean
}

export function QuickStatusCell({ workId, statusId, canEdit }: QuickStatusCellProps) {
  const refresh = useRefresh()
  const { requestOpen } = useWorkStatusGate()
  const [pending, startTransition] = useTransition()
  const [current, setCurrent] = useState<number | null>(statusId)
  const [syncedProp, setSyncedProp] = useState<number | null>(statusId)

  // O servidor é a verdade: quando o revalidate chega, o otimista cede o lugar. Ajuste
  // DURANTE o render (padrão oficial do React), não em `useEffect` — o efeito repintaria a
  // tela com o valor velho antes de corrigir. Semeado com o valor inicial de propósito: com
  // `null` aqui, a comparação dispararia já na renderização de HIDRATAÇÃO.
  if (statusId !== syncedProp) {
    setSyncedProp(statusId)
    setCurrent(statusId)
  }

  if (!canEdit) {
    return (
      <div className={CELL_CLASS}>
        <span className={LABEL_CLASS}>Pessoal</span>
        <PersonalStatusBadge statusId={statusId} />
      </div>
    )
  }

  const currentName = current != null ? PERSONAL_STATUSES_BY_ID[current]?.status : null

  const pick = (name: string) => {
    const nextId = STATUS_INFO_BY_NAME[name]?.id ?? null
    if (nextId == null || nextId === current) return
    const previous = current
    setCurrent(nextId) // otimista: o badge troca no clique, não depois do round-trip
    // Status terminal (Finished/Dropped) = leitura encerrou → abre "Meu Status" pra completar
    // nota/atributos. Dispara junto do otimista (não espera o servidor) — mesmo timing do
    // gate de capítulos em QuickChaptersCell, e a mesma lógica de reverter no erro cobre o
    // raro caso de a escrita falhar com o diálogo já aberto.
    if (isTerminalPersonalStatus(nextId)) {
      requestOpen({ personal_status: name as WorkStatusValues["personal_status"], personal_status_id: nextId })
    }
    startTransition(async () => {
      const res = await setReadingStatusForWorks([workId], name)
      if (res && "error" in res && res.error) {
        setCurrent(previous)
        toast.error("Não deu pra mudar o status", { description: res.error })
        return
      }
      toast.success(`Status: ${name}`)
      refresh()
    })
  }

  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Pessoal</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="group -mx-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-foreground/5"
          disabled={pending}
          aria-label="Mudar status de leitura"
          title="Mudar status de leitura"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <PersonalStatusBadge statusId={current} />
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-[min(22rem,60vh)] w-64 overflow-y-auto">
          {PERSONAL_STATUSES.map((name) => {
            const info = STATUS_INFO_BY_NAME[name]
            const active = name === currentName
            return (
              <DropdownMenuItem
                key={name}
                onSelect={() => pick(name)}
                className={cn("gap-2", active && "bg-primary/10 font-semibold")}
                title={info?.descriptionPt ?? undefined}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: info?.color ?? "var(--muted-foreground)" }}
                />
                <span aria-hidden className="w-4 shrink-0 text-center">
                  {info?.symbol}
                </span>
                <span className="min-w-0 truncate">{name}</span>
                {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export interface QuickInterestCellProps {
  workId: string
  /** Interesse manual atual (♥..♥♥♥♥), ou null quando não avaliado. */
  value: string | null
  /** `synopsis_quality_source === "prediction_applied"` ⇒ mostra o selo ✨. */
  fromPrediction: boolean
  canEdit: boolean
}

export function QuickInterestCell({
  workId,
  value,
  fromPrediction,
  canEdit,
}: QuickInterestCellProps) {
  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Interesse</span>
      {canEdit ? (
        <SynopsisQualityPicker
          workId={workId}
          value={value}
          fromPrediction={fromPrediction}
          subtleClear
        />
      ) : value ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
          {value}
        </span>
      ) : (
        <span
          className="font-mono text-sm font-semibold text-muted-foreground"
          title="Interesse na sinopse ainda não informado"
        >
          —
        </span>
      )}
    </div>
  )
}
