"use client"

import { useState, useTransition } from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useRefresh } from "@/lib/use-refresh"
import { cn } from "@/lib/utils"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setReadingStatusForWorks } from "@/server/actions/works"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { PERSONAL_STATUSES } from "@/types/domain"

/**
 * Controles rápidos da faixa de stats da página da obra: trocar o status de leitura e o
 * Interesse ♥ sem abrir "Meu Status".
 *
 * A faixa é PERSISTENTE (fica fora do `<TabsContent>`), então os dois atalhos valem nas 5
 * abas — não só na Visão Geral.
 *
 * ⚠️ Estes dois campos vão por caminhos DIFERENTES no servidor, e é de propósito:
 *  - status  → `setReadingStatusForWorks` (só `personal_status_id`, sem tocar em capítulos,
 *              notas ou observações — o form completo continua sendo o lugar disso);
 *  - ♥       → `setSynopsisQualityAction`, que é feature do Ridge e marca recálculo pendente.
 * Os dois usam o MESMO gate (`ensureReadingStateWriter`): dado pessoal, qualquer usuário
 * logado. O que é restrito é PREVER o interesse por IA, não declará-lo.
 */

/** Mesmo layout das demais células da faixa — mantido em sincronia com app/titles/[id]/page.tsx. */
const CELL_CLASS = "flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5"
const LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"

const STATUS_INFO_BY_NAME = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info]),
)

export interface QuickStatusCellProps {
  workId: string
  /** Status atual (`works.personal_status_id`), ou null quando a obra nunca foi tocada. */
  statusId: number | null
  /** false ⇒ visitante anônimo: mostra o badge estático, sem afordância de clique. */
  canEdit: boolean
}

export function QuickStatusCell({ workId, statusId, canEdit }: QuickStatusCellProps) {
  const refresh = useRefresh()
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
