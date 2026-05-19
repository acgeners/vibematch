"use client"

import { useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import { ChevronDown, Filter, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
  type PublicationStatusInfo,
  type PersonalStatusInfo,
} from "@/lib/constants/criteria"

type EvaluationFilter = "pending" | "low-confidence" | "outdated-model"

interface AiEvaluationFiltersProps {
  activeFilters: EvaluationFilter[]
  currentModel: string
  currentPromptVersion: string
  currentPromptVersionNum: number
  promptVersionTolerance: number
  lowConfidenceThreshold: number
  activePubStatuses: string[]
  activePersonalStatuses: string[]
}

const PUB_STATUSES = Object.values(PUBLICATION_STATUSES_BY_ID)
const PERSONAL_STATUSES = Object.values(PERSONAL_STATUSES_BY_ID)

export function AiEvaluationFilters({
  activeFilters,
  currentModel,
  currentPromptVersion,
  currentPromptVersionNum,
  promptVersionTolerance,
  lowConfidenceThreshold,
  activePubStatuses,
  activePersonalStatuses,
}: AiEvaluationFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const updateParams = (mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  const setFilter = (filter: EvaluationFilter, on: boolean) => {
    const next = new Set(activeFilters)
    if (on) next.add(filter)
    else next.delete(filter)

    updateParams((params) => {
      if (next.size === 0 || (next.size === 1 && next.has("pending"))) {
        params.delete("filter")
      } else {
        params.set("filter", [...next].join(","))
      }
    })
  }

  const toggleStatus = (key: "pub" | "personal", value: string, current: string[]) => {
    const next = new Set(current)
    if (next.has(value)) next.delete(value)
    else next.add(value)

    updateParams((params) => {
      if (next.size === 0) params.delete(key)
      else params.set(key, [...next].join(","))
    })
  }

  const clearAll = () => {
    updateParams((params) => {
      params.delete("filter")
      params.delete("pub")
      params.delete("personal")
    })
  }

  const isOn = (f: EvaluationFilter) => activeFilters.includes(f)

  const outdatedDescription = (() => {
    if (promptVersionTolerance <= 0) {
      return `Modelo ≠ ${currentModel} ou prompt ≠ ${currentPromptVersion}`
    }
    const cutoff = Math.max(0, currentPromptVersionNum - promptVersionTolerance)
    return `Modelo ≠ ${currentModel} ou prompt ≤ v${cutoff} (tolerância ${promptVersionTolerance})`
  })()

  const stateOptions: Array<{ id: EvaluationFilter; label: string; tooltip: string }> = [
    {
      id: "pending",
      label: "Sem avaliação",
      tooltip: "Obras com ai_eval_status = pending",
    },
    {
      id: "low-confidence",
      label: `Confiança < ${Math.round(lowConfidenceThreshold * 100)}%`,
      tooltip: "Avaliações de baixa confiança da IA",
    },
    {
      id: "outdated-model",
      label: "Modelo/prompt antigos",
      tooltip: outdatedDescription,
    },
  ]

  const activeCount =
    (activeFilters.length === 1 && activeFilters[0] === "pending" ? 0 : activeFilters.length) +
    activePubStatuses.length +
    activePersonalStatuses.length

  const hasAnyActive =
    activeFilters.some((f) => f !== "pending") ||
    activePubStatuses.length > 0 ||
    activePersonalStatuses.length > 0

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "rounded-xl border border-border/70 bg-card/58 p-3 shadow-sm shadow-black/5 backdrop-blur",
          isPending && "opacity-60"
        )}
      >
        {/* Compact header */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Filter className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-sm font-semibold">Filtros</h2>
            {activeCount > 0 && (
              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {activeCount}
              </span>
            )}
            <p className="hidden text-xs text-muted-foreground sm:block">
              Uma obra aparece se atende qualquer filtro.
            </p>
          </div>

          {hasAnyActive && (
            <Button variant="ghost" size="xs" onClick={clearAll} disabled={isPending}>
              <X className="h-3 w-3" />
              Limpar
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          {/* Estado da avaliação */}
          <FilterSection title="Estado da avaliação">
            <div className="flex flex-wrap gap-1">
              {stateOptions.map((opt) => {
                const active = isOn(opt.id)
                return (
                  <Tooltip key={opt.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setFilter(opt.id, !active)}
                      >
                        <Badge
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer text-xs"
                        >
                          {opt.label}
                        </Badge>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs whitespace-pre-line text-xs">
                      {opt.tooltip}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </FilterSection>

          {/* Status */}
          <FilterSection title="Status">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <StatusGroup
                label="Publicação"
                options={PUB_STATUSES}
                active={activePubStatuses}
                onToggle={(value) => toggleStatus("pub", value, activePubStatuses)}
              />
              <StatusGroup
                label="Leitura"
                options={PERSONAL_STATUSES}
                active={activePersonalStatuses}
                onToggle={(value) => toggleStatus("personal", value, activePersonalStatuses)}
              />
            </div>
          </FilterSection>
        </div>
      </div>
    </TooltipProvider>
  )
}

function StatusGroup({
  label,
  options,
  active,
  onToggle,
}: {
  label: string
  options: Array<PublicationStatusInfo | PersonalStatusInfo>
  active: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const isActive = active.includes(opt.status)
          return (
            <button key={opt.id} type="button" onClick={() => onToggle(opt.status)}>
              <Badge
                variant={isActive ? "default" : "outline"}
                className="cursor-pointer gap-1 text-xs"
              >
                <span aria-hidden>{opt.symbol}</span>
                {opt.status}
              </Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface FilterSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function FilterSection({ title, defaultOpen = true, children }: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg border border-border/65 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-card/60 px-3 py-1.5 text-left transition-colors hover:bg-card/80"
      >
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 py-2.5">
          {children}
        </div>
      )}
    </div>
  )
}
