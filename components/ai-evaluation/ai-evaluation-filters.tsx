"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import { Filter, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { PERSONAL_STATUSES as PERSONAL_STATUS_NAMES, SYNOPSIS_QUALITIES } from "@/types/domain"
import { getPersonalStatusDescription } from "@/lib/constants/personal-status-descriptions"

type EvaluationFilter = "pending" | "review-pending" | "low-confidence" | "outdated-model" | "outdated-reviews"
const DEFAULT_FILTERS: EvaluationFilter[] = ["pending", "review-pending"]

const IA_RK_STATE_OPTIONS: Array<{ id: "stale" | "unranked"; label: string; tooltip: string }> = [
  { id: "stale", label: "Desatualizado", tooltip: "Tem Veredito IA, mas ficou velho (obra editada / re-avaliada / 'Atualizar dados')." },
  { id: "unranked", label: "Não avaliado", tooltip: "Ainda não tem Veredito IA (nunca passou pelo re-rank)." },
]

const SYNOPSIS_STATE_OPTIONS: Array<{ id: "stale" | "unpredicted" | "predicted"; label: string; tooltip: string }> = [
  { id: "stale", label: "Desatualizado", tooltip: "Tem previsão, mas ficou velha (perfil de gosto ou sinopse mudou)." },
  { id: "unpredicted", label: "Não previsto", tooltip: "Ainda não tem estimativa de Interesse Sinopse." },
  { id: "predicted", label: "Previsto", tooltip: "Já tem estimativa fresca — pra comparar o valor manual com o da IA." },
]

function isDefaultFilterSet(filters: Set<EvaluationFilter> | EvaluationFilter[]) {
  const set = Array.isArray(filters) ? new Set(filters) : filters
  return set.size === DEFAULT_FILTERS.length && DEFAULT_FILTERS.every((filter) => set.has(filter))
}

interface AiEvaluationFiltersProps {
  activeFilters: EvaluationFilter[]
  currentModel: string
  currentPromptVersion: string
  currentPromptVersionNum: number
  promptVersionTolerance: number
  lowConfidenceThreshold: number
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  /** Interesse na sinopse (♥–♥♥♥♥) ativos. Compartilhado pelas 2 abas. */
  activeSynopsisQualities?: string[]
  /** Quando false, esconde a seção "Estado da avaliação" (usado na aba Veredito IA). */
  showEvalState?: boolean
  /** Mostra a seção "Estado do Veredito IA" (Desatualizado/Não avaliado) — aba Veredito IA. */
  showIaRkState?: boolean
  /** Estados de Veredito IA ativos ("stale"/"unranked"). */
  activeIaRkStates?: string[]
  /** Mostra a seção "Estado da previsão" (aba Interesse Sinopse). */
  showSynopsisState?: boolean
  /** Estados de previsão ativos ("stale"/"unpredicted"/"predicted"). */
  activeSynopsisStates?: string[]
}

const PUB_STATUSES = Object.values(PUBLICATION_STATUSES_BY_ID)
const PERSONAL_STATUSES = PERSONAL_STATUS_NAMES.map((name) =>
  Object.values(PERSONAL_STATUSES_BY_ID).find((info) => info.status === name)
).filter((info): info is PersonalStatusInfo => !!info)

export function AiEvaluationFilters({
  activeFilters,
  currentModel,
  currentPromptVersion,
  currentPromptVersionNum,
  promptVersionTolerance,
  lowConfidenceThreshold,
  activePubStatuses,
  activePersonalStatuses,
  activeSynopsisQualities = [],
  showEvalState = true,
  showIaRkState = false,
  activeIaRkStates = [],
  showSynopsisState = false,
  activeSynopsisStates = [],
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
      if (next.size === 0 || isDefaultFilterSet(next)) {
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

  const toggleSynopsisQuality = (value: string) => {
    const next = new Set(activeSynopsisQualities)
    if (next.has(value)) next.delete(value)
    else next.add(value)

    updateParams((params) => {
      if (next.size === 0) params.delete("synopsis_q")
      else params.set("synopsis_q", [...next].join(","))
    })
  }

  const toggleIaRkState = (value: string) => {
    const next = new Set(activeIaRkStates)
    if (next.has(value)) next.delete(value)
    else next.add(value)

    updateParams((params) => {
      // Default da aba Veredito IA = {stale} (só "Desatualizado") → URL limpa.
      if (next.size === 1 && next.has("stale")) params.delete("rk")
      else if (next.size === 0) params.set("rk", "none")
      else params.set("rk", [...next].join(","))
    })
  }

  const toggleSynopsisState = (value: string) => {
    const next = new Set(activeSynopsisStates)
    if (next.has(value)) next.delete(value)
    else next.add(value)

    updateParams((params) => {
      // Default da aba Sinopse = {unpredicted} (só "Não previsto") → URL limpa.
      if (next.size === 1 && next.has("unpredicted")) params.delete("sq")
      else if (next.size === 0) params.set("sq", "none")
      else params.set("sq", [...next].join(","))
    })
  }

  const clearAll = () => {
    updateParams((params) => {
      params.delete("filter")
      params.delete("pub")
      params.delete("personal")
      params.delete("synopsis_q")
      params.delete("tolerance")
      params.delete("rk")
      params.delete("sq")
    })
  }

  const setTolerance = (value: number) => {
    updateParams((params) => {
      if (value <= 0) params.delete("tolerance")
      else params.set("tolerance", String(value))
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
      id: "review-pending",
      label: "Aguardando revisão",
      tooltip: "Obras com ai_eval_status = review_pending",
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
    {
      id: "outdated-reviews",
      label: "Reviews novas",
      tooltip:
        "Avaliação concluída cujo conjunto de reviews mudou depois — os atributos (e a Nota Prevista) podem estar defasados. Re-avaliar incorpora as reviews novas.",
    },
  ]

  const evalFilterCount =
    showEvalState && !isDefaultFilterSet(activeFilters) ? activeFilters.length : 0
  // Default da aba Veredito IA = {stale} (só "Desatualizado"). Qualquer desvio conta.
  const iaRkFilterActive =
    showIaRkState && [...activeIaRkStates].sort().join(",") !== "stale"
  // Default da aba Sinopse = {unpredicted} (só "Não previsto"). Qualquer desvio
  // conta como filtro ativo.
  const synopsisFilterActive =
    showSynopsisState && [...activeSynopsisStates].sort().join(",") !== "unpredicted"
  const activeCount =
    evalFilterCount +
    (iaRkFilterActive ? 1 : 0) +
    (synopsisFilterActive ? 1 : 0) +
    activePubStatuses.length +
    activePersonalStatuses.length +
    activeSynopsisQualities.length

  const hasAnyActive =
    (showEvalState && !isDefaultFilterSet(activeFilters)) ||
    iaRkFilterActive ||
    synopsisFilterActive ||
    activePubStatuses.length > 0 ||
    activePersonalStatuses.length > 0 ||
    activeSynopsisQualities.length > 0

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
              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
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
          {showEvalState && (
          <FilterSection title="Estado da avaliação">
            <div className="flex flex-wrap items-center gap-1">
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
              {isOn("outdated-model") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="ml-1 flex items-center gap-1 rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">
                      <span>Δ versão:</span>
                      <Input
                        type="number"
                        min={0}
                        max={currentPromptVersionNum}
                        value={promptVersionTolerance}
                        onChange={(e) => setTolerance(Math.max(0, parseInt(e.target.value) || 0))}
                        className="h-5 w-12 px-1 py-0 text-xs"
                        disabled={isPending}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Quantas versões para trás ainda contam como atuais. 0 = só {currentPromptVersion}; 2 = ≥ v{Math.max(0, currentPromptVersionNum - 2)}.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </FilterSection>
          )}

          {showIaRkState && (
            <FilterSection title="Estado do Veredito IA">
              <div className="flex flex-wrap items-center gap-1">
                {IA_RK_STATE_OPTIONS.map((opt) => {
                  const active = activeIaRkStates.includes(opt.id)
                  return (
                    <Tooltip key={opt.id}>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={() => toggleIaRkState(opt.id)}>
                          <Badge
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                          >
                            {opt.label}
                          </Badge>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">{opt.tooltip}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </FilterSection>
          )}

          {showSynopsisState && (
            <FilterSection title="Estado da previsão">
              <div className="flex flex-wrap items-center gap-1">
                {SYNOPSIS_STATE_OPTIONS.map((opt) => {
                  const active = activeSynopsisStates.includes(opt.id)
                  return (
                    <Tooltip key={opt.id}>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={() => toggleSynopsisState(opt.id)}>
                          <Badge
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                          >
                            {opt.label}
                          </Badge>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">{opt.tooltip}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </FilterSection>
          )}

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
                tooltipFor={(opt) =>
                  getPersonalStatusDescription(opt.status, (opt as PersonalStatusInfo).comment)
                }
              />
            </div>
          </FilterSection>

          {/* Interesse na sinopse */}
          <FilterSection title="Interesse na sinopse">
            <div className="flex flex-wrap items-center gap-1">
              {SYNOPSIS_QUALITIES.map((q) => {
                const active = activeSynopsisQualities.includes(q)
                return (
                  <button key={q} type="button" onClick={() => toggleSynopsisQuality(q)}>
                    <Badge
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer text-sm"
                    >
                      {q}
                    </Badge>
                  </button>
                )
              })}
              {/* Triagem manual (só na aba Interesse Sinopse): obras ainda sem
                  Interesse informado (synopsis_quality IS NULL). */}
              {showSynopsisState && (
                <button type="button" onClick={() => toggleSynopsisQuality("none")}>
                  <Badge
                    variant={activeSynopsisQualities.includes("none") ? "default" : "outline"}
                    className="cursor-pointer text-sm"
                  >
                    Não avaliada
                  </Badge>
                </button>
              )}
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
  tooltipFor,
}: {
  label: string
  options: Array<PublicationStatusInfo | PersonalStatusInfo>
  active: string[]
  onToggle: (value: string) => void
  /** Texto de tooltip por opção. Quando vazio/ausente, não renderiza tooltip. */
  tooltipFor?: (opt: PublicationStatusInfo | PersonalStatusInfo) => string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const isActive = active.includes(opt.status)
          const tip = tooltipFor?.(opt)
          const button = (
            <button type="button" onClick={() => onToggle(opt.status)}>
              <Badge
                variant={isActive ? "default" : "outline"}
                className="cursor-pointer gap-1 text-xs"
              >
                <span aria-hidden>{opt.symbol}</span>
                {opt.status}
              </Badge>
            </button>
          )
          if (!tip) return <span key={opt.id}>{button}</span>
          return (
            <Tooltip key={opt.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent className="max-w-xs whitespace-pre-line text-xs">
                {tip}
              </TooltipContent>
            </Tooltip>
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

function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/65 bg-background/40">
      <div className="flex w-full items-center justify-between gap-3 bg-card/60 px-3 py-1.5 text-left">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="border-t border-border/60 px-3 py-2.5">
        {children}
      </div>
    </div>
  )
}
