"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState, useTransition } from "react"
import { ChevronRight, Filter, X } from "lucide-react"
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

// Delta = nível previsto − nível atual (♥=1…♥♥♥♥=4) ⇒ range -3..+3.
const DELTA_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "-3", label: "−3" },
  { id: "-2", label: "−2" },
  { id: "-1", label: "−1" },
  { id: "0", label: "0" },
  { id: "1", label: "+1" },
  { id: "2", label: "+2" },
  { id: "3", label: "+3" },
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
  /** Config do modelo/prompt — só usada na seção "Estado da avaliação" (showEvalState).
   *  Opcional: abas sem essa seção (Veredito/Interesse/Tags&Reviews/Untracked) não passam. */
  currentModel?: string
  currentPromptVersion?: string
  currentPromptVersionNum?: number
  promptVersionTolerance?: number
  lowConfidenceThreshold?: number
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  /** Interesse na sinopse (♥–♥♥♥♥) ativos. Compartilhado por várias abas. */
  activeSynopsisQualities?: string[]
  /** Quando false, esconde a seção "Estado da avaliação" (usado na aba Veredito IA). */
  showEvalState?: boolean
  /** Quando false, esconde o grupo de status "Leitura" (usado na aba Untracked, onde
   *  todas as obras são Untracked). */
  showPersonalStatus?: boolean
  /** Mostra o chip "Não avaliada" (Interesse ainda não informado) — abas Interesse
   *  Sinopse e Tags & Reviews. Na aba Interesse é implícito por showSynopsisState. */
  showInterestNone?: boolean
  /** Mostra a seção "Estado do Veredito IA" (Desatualizado/Não avaliado) — aba Veredito IA. */
  showIaRkState?: boolean
  /** Estados de Veredito IA ativos ("stale"/"unranked"). */
  activeIaRkStates?: string[]
  /** Mostra a seção "Estado da previsão" (aba Interesse Sinopse). */
  showSynopsisState?: boolean
  /** Estados de previsão ativos ("stale"/"unpredicted"/"predicted"). */
  activeSynopsisStates?: string[]
  /** Valores previstos pela IA ativos (♥–♥♥♥♥) — aba Interesse na Obra. */
  activePredictionQualities?: string[]
  /** Versões de previsão ativas (ex.: ["v3"]) — aba Interesse na Obra. */
  activePredictionVersions?: string[]
  /** Versões de previsão disponíveis (pra montar os chips). */
  predictionVersionOptions?: string[]
  /** Deltas previsto−atual ativos ("up"/"eq"/"down") — aba Interesse na Obra. */
  activePredictionDeltas?: string[]
  /** Mostra a seção "Dados (nº)" (faixa mín–máx de tags / reviews) — abas Interesse
   *  Sinopse e Tags & Reviews. */
  showDataFilters?: boolean
  /** Faixa de tags ativa (0 = sem limite). */
  activeMinTags?: number
  activeMaxTags?: number
  /** Faixa de reviews úteis ativa (0 = sem limite). */
  activeMinReviews?: number
  activeMaxReviews?: number
  /** Seleção-padrão de status "Leitura" (quando a URL não tem `personal`) — usada
   *  pro clean-URL e "Limpar". Vazio = default é "todos". */
  defaultPersonalStatuses?: string[]
}

const PUB_STATUSES = Object.values(PUBLICATION_STATUSES_BY_ID)
const PERSONAL_STATUSES = PERSONAL_STATUS_NAMES.map((name) =>
  Object.values(PERSONAL_STATUSES_BY_ID).find((info) => info.status === name)
).filter((info): info is PersonalStatusInfo => !!info)

/** Rascunho local dos filtros — espelha os props (já parseados no server) e só é
 *  serializado na URL quando o usuário clica "Aplicar". */
interface FilterDraft {
  filters: EvaluationFilter[]
  pub: string[]
  personal: string[]
  synQ: string[]
  iaRk: string[]
  synState: string[]
  predQ: string[]
  predV: string[]
  predD: string[]
  minTags: number
  maxTags: number
  minReviews: number
  maxReviews: number
  tolerance: number
}

export function AiEvaluationFilters({
  activeFilters,
  currentModel = "",
  currentPromptVersion = "",
  currentPromptVersionNum = 0,
  promptVersionTolerance = 0,
  lowConfidenceThreshold = 0.8,
  activePubStatuses,
  activePersonalStatuses,
  activeSynopsisQualities = [],
  showEvalState = true,
  showPersonalStatus = true,
  showInterestNone = false,
  showIaRkState = false,
  activeIaRkStates = [],
  showSynopsisState = false,
  activeSynopsisStates = [],
  activePredictionQualities = [],
  activePredictionVersions = [],
  predictionVersionOptions = [],
  activePredictionDeltas = [],
  showDataFilters = false,
  activeMinTags = 0,
  activeMaxTags = 0,
  activeMinReviews = 0,
  activeMaxReviews = 0,
  defaultPersonalStatuses = [],
}: AiEvaluationFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Filtros viram um RASCUNHO local: alternar chips só muda o estado local; nada
  // navega/bate no banco até clicar "Aplicar". Assim dá pra ajustar vários filtros
  // e disparar UMA navegação/refetch só (antes era 1 round-trip por clique, caro
  // contra o DB remoto). O rascunho é semeado pelos props (já parseados no server)
  // e re-semeado quando a URL aplicada muda (após Aplicar / troca de aba).
  const makeDraft = (): FilterDraft => ({
    filters: activeFilters,
    pub: activePubStatuses,
    personal: activePersonalStatuses,
    synQ: activeSynopsisQualities,
    iaRk: activeIaRkStates,
    synState: activeSynopsisStates,
    predQ: activePredictionQualities,
    predV: activePredictionVersions,
    predD: activePredictionDeltas,
    minTags: activeMinTags,
    maxTags: activeMaxTags,
    minReviews: activeMinReviews,
    maxReviews: activeMaxReviews,
    tolerance: promptVersionTolerance,
  })
  const [draft, setDraft] = useState<FilterDraft>(makeDraft)
  // Re-semeia o rascunho quando a URL aplicada (props) muda — após Aplicar / troca
  // de aba. Padrão "ajustar estado na renderização" (sem useEffect): compara a
  // assinatura dos props e re-semeia quando difere.
  const propsSignature = JSON.stringify([
    activeFilters, activePubStatuses, activePersonalStatuses, activeSynopsisQualities,
    activeIaRkStates, activeSynopsisStates, activePredictionQualities,
    activePredictionVersions, activePredictionDeltas, activeMinTags, activeMaxTags,
    activeMinReviews, activeMaxReviews, promptVersionTolerance,
  ])
  const [seenSignature, setSeenSignature] = useState(propsSignature)
  if (propsSignature !== seenSignature) {
    setSeenSignature(propsSignature)
    setDraft(makeDraft())
  }

  // "Mais filtros" (avançadas) — abre por padrão só quando já há alguma ativa.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() =>
    (showSynopsisState ? activePredictionQualities.length + activePredictionVersions.length + activePredictionDeltas.length : 0) +
    (showDataFilters ? [activeMinTags, activeMaxTags, activeMinReviews, activeMaxReviews].filter((n) => n > 0).length : 0) > 0,
  )

  // Serializa o rascunho na URL, preservando params não-gerenciados (tab, etc.).
  // Cada dimensão só é escrita na aba que a exibe (mesma condição da UI) pra não
  // injetar params de outra aba.
  const buildParams = (d: FilterDraft): URLSearchParams => {
    const p = new URLSearchParams(searchParams.toString())
    if (showEvalState) {
      const f = new Set(d.filters)
      if (f.size === 0 || isDefaultFilterSet(f)) p.delete("filter")
      else p.set("filter", [...f].join(","))
      if (d.tolerance <= 0) p.delete("tolerance")
      else p.set("tolerance", String(d.tolerance))
    }
    if (d.pub.length === 0) p.delete("pub")
    else p.set("pub", d.pub.join(","))
    if (sameSet(d.personal, defaultPersonalStatuses)) p.delete("personal")
    else p.set("personal", d.personal.join(","))
    if (d.synQ.length === 0) p.delete("synopsis_q")
    else p.set("synopsis_q", d.synQ.join(","))
    if (showIaRkState) {
      const rk = new Set(d.iaRk)
      // Default da aba Veredito IA = {stale} → URL limpa.
      if (rk.size === 1 && rk.has("stale")) p.delete("rk")
      else if (rk.size === 0) p.set("rk", "none")
      else p.set("rk", [...rk].join(","))
    }
    if (showSynopsisState) {
      const sq = new Set(d.synState)
      // Default da aba Sinopse = {unpredicted} → URL limpa.
      if (sq.size === 1 && sq.has("unpredicted")) p.delete("sq")
      else if (sq.size === 0) p.set("sq", "none")
      else p.set("sq", [...sq].join(","))
      if (d.predQ.length === 0) p.delete("pq")
      else p.set("pq", d.predQ.join(","))
      if (d.predV.length === 0) p.delete("pv")
      else p.set("pv", d.predV.join(","))
      if (d.predD.length === 0) p.delete("pd")
      else p.set("pd", d.predD.join(","))
    }
    if (showDataFilters) {
      const setNum = (key: string, v: number) => (v > 0 ? p.set(key, String(v)) : p.delete(key))
      setNum("mintags", d.minTags)
      setNum("maxtags", d.maxTags)
      setNum("minrev", d.minReviews)
      setNum("maxrev", d.maxReviews)
    }
    return p
  }

  const navigate = (p: URLSearchParams) => {
    const qs = p.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  const apply = () => navigate(buildParams(draft))

  // Há mudanças não aplicadas? Compara a assinatura das chaves gerenciadas.
  const OWNED_KEYS = ["filter", "pub", "personal", "synopsis_q", "tolerance", "rk", "sq", "pq", "pv", "pd", "mintags", "maxtags", "minrev", "maxrev"]
  const ownedSig = (p: URLSearchParams) => OWNED_KEYS.map((k) => `${k}=${p.get(k) ?? ""}`).join("&")
  const isDirty = ownedSig(buildParams(draft)) !== ownedSig(new URLSearchParams(searchParams.toString()))

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value]

  const setFilter = (filter: EvaluationFilter, on: boolean) => {
    setDraft((d) => ({
      ...d,
      filters: on
        ? (d.filters.includes(filter) ? d.filters : [...d.filters, filter])
        : d.filters.filter((f) => f !== filter),
    }))
  }

  const toggleStatus = (key: "pub" | "personal", value: string) => {
    setDraft((d) =>
      key === "pub"
        ? { ...d, pub: toggleIn(d.pub, value) }
        : { ...d, personal: toggleIn(d.personal, value) },
    )
  }

  const toggleSynopsisQuality = (value: string) => {
    setDraft((d) => ({ ...d, synQ: toggleIn(d.synQ, value) }))
  }

  const toggleIaRkState = (value: string) => {
    setDraft((d) => ({ ...d, iaRk: toggleIn(d.iaRk, value) }))
  }

  const toggleSynopsisState = (value: string) => {
    setDraft((d) => ({ ...d, synState: toggleIn(d.synState, value) }))
  }

  const togglePredictionQuality = (value: string) => {
    setDraft((d) => ({ ...d, predQ: toggleIn(d.predQ, value) }))
  }

  const togglePredictionVersion = (value: string) => {
    setDraft((d) => ({ ...d, predV: toggleIn(d.predV, value) }))
  }

  const togglePredictionDelta = (value: string) => {
    setDraft((d) => ({ ...d, predD: toggleIn(d.predD, value) }))
  }

  const clearAll = () => {
    const cleared: FilterDraft = {
      filters: [...DEFAULT_FILTERS],
      pub: [],
      personal: [...defaultPersonalStatuses],
      synQ: [],
      iaRk: ["stale"],
      synState: ["unpredicted"],
      predQ: [],
      predV: [],
      predD: [],
      minTags: 0,
      maxTags: 0,
      minReviews: 0,
      maxReviews: 0,
      tolerance: 0,
    }
    setDraft(cleared)
    navigate(buildParams(cleared))
  }

  const setTolerance = (value: number) => {
    setDraft((d) => ({ ...d, tolerance: value }))
  }

  const setMinTags = (value: number) => setDraft((d) => ({ ...d, minTags: value }))
  const setMaxTags = (value: number) => setDraft((d) => ({ ...d, maxTags: value }))
  const setMinReviews = (value: number) => setDraft((d) => ({ ...d, minReviews: value }))
  const setMaxReviews = (value: number) => setDraft((d) => ({ ...d, maxReviews: value }))

  const isOn = (f: EvaluationFilter) => draft.filters.includes(f)

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
    showEvalState && !isDefaultFilterSet(draft.filters) ? draft.filters.length : 0
  // Default da aba Veredito IA = {stale} (só "Desatualizado"). Qualquer desvio conta.
  const iaRkFilterActive =
    showIaRkState && [...draft.iaRk].sort().join(",") !== "stale"
  // Default da aba Sinopse = {unpredicted} (só "Não previsto"). Qualquer desvio
  // conta como filtro ativo.
  const synopsisFilterActive =
    showSynopsisState && [...draft.synState].sort().join(",") !== "unpredicted"

  // Filtros "avançados" (recolhidos em "Mais filtros"): previsão/versão/Δ, faixas
  // numéricas, fonte externa, golden.
  const dataActiveCount = showDataFilters
    ? [draft.minTags, draft.maxTags, draft.minReviews, draft.maxReviews].filter((n) => n > 0).length
    : 0
  const advancedActiveCount =
    (showSynopsisState ? draft.predQ.length + draft.predV.length + draft.predD.length : 0) +
    dataActiveCount
  const hasAdvanced = showSynopsisState || showDataFilters

  const activeCount =
    evalFilterCount +
    (iaRkFilterActive ? 1 : 0) +
    (synopsisFilterActive ? 1 : 0) +
    draft.pub.length +
    draft.personal.length +
    draft.synQ.length +
    advancedActiveCount

  const hasAnyActive =
    (showEvalState && !isDefaultFilterSet(draft.filters)) ||
    iaRkFilterActive ||
    synopsisFilterActive ||
    draft.pub.length > 0 ||
    draft.personal.length > 0 ||
    draft.synQ.length > 0 ||
    advancedActiveCount > 0

  const showInterestNoneChip = showInterestNone || showSynopsisState

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
          </div>

          <div className="flex items-center gap-1.5">
            {isDirty && !isPending && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
                alterações não aplicadas
              </span>
            )}
            {hasAnyActive && (
              <Button variant="ghost" size="xs" onClick={clearAll} disabled={isPending}>
                <X className="h-3 w-3" />
                Limpar
              </Button>
            )}
            <Button size="xs" onClick={apply} disabled={!isDirty || isPending}>
              {isPending ? "Aplicando…" : "Aplicar"}
            </Button>
          </div>
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
                        value={draft.tolerance}
                        onChange={(e) => setTolerance(Math.max(0, parseInt(e.target.value) || 0))}
                        onKeyDown={(e) => { if (e.key === "Enter") apply() }}
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
                  const active = draft.iaRk.includes(opt.id)
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
                  const active = draft.synState.includes(opt.id)
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
                active={draft.pub}
                onToggle={(value) => toggleStatus("pub", value)}
              />
              {showPersonalStatus && (
                <StatusGroup
                  label="Leitura"
                  options={PERSONAL_STATUSES}
                  active={draft.personal}
                  onToggle={(value) => toggleStatus("personal", value)}
                  tooltipFor={(opt) =>
                    getPersonalStatusDescription(opt.status, (opt as PersonalStatusInfo).comment)
                  }
                />
              )}
            </div>
          </FilterSection>

          {/* Interesse manual — primário, sempre visível. */}
          <FilterSection title="Interesse">
            <div className="flex flex-wrap items-center gap-1">
              {SYNOPSIS_QUALITIES.map((q) => {
                const active = draft.synQ.includes(q)
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
              {/* Triagem manual: obras ainda sem Interesse informado (synopsis_quality IS NULL). */}
              {showInterestNoneChip && (
                <button type="button" onClick={() => toggleSynopsisQuality("none")}>
                  <Badge
                    variant={draft.synQ.includes("none") ? "default" : "outline"}
                    className="cursor-pointer text-sm"
                  >
                    Não avaliada
                  </Badge>
                </button>
              )}
              {/* Proveniência legada: tem um valor de Interesse não-confirmado
                  (source=legacy_unknown) — separa dos human_manual. */}
              {showSynopsisState && (
                <button
                  type="button"
                  onClick={() => toggleSynopsisQuality("unknown")}
                  title="Tem um valor de Interesse de proveniência legada/não-confirmada (não definido por você)"
                >
                  <Badge
                    variant={draft.synQ.includes("unknown") ? "default" : "outline"}
                    className="cursor-pointer text-sm"
                  >
                    Desconhecido
                  </Badge>
                </button>
              )}
            </div>
          </FilterSection>

          {/* "Mais filtros" — dimensões avançadas recolhidas (previsão da IA, versão,
              Δ previsto×atual, faixas numéricas). Só nas abas que as exibem. */}
          {hasAdvanced && (
            <div className="rounded-lg border border-border/65 bg-background/40">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center gap-1.5 bg-card/60 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-90")} />
                Mais filtros
                {advancedActiveCount > 0 && (
                  <span className="rounded-full border border-border/70 px-1.5 text-[10px] font-medium normal-case tracking-normal">
                    {advancedActiveCount}
                  </span>
                )}
              </button>
              {showAdvanced && (
                <div className="flex flex-col gap-1.5 border-t border-border/60 p-2.5 sm:flex-row sm:flex-wrap sm:items-start">
                  {/* Previsão da IA (valor previsto). */}
                  {showSynopsisState && (
                    <div className="sm:grow sm:shrink-0">
                      <FilterSection title="Previsão da IA">
                        <div className="flex flex-wrap items-center gap-1">
                          {SYNOPSIS_QUALITIES.map((q) => {
                            const active = draft.predQ.includes(q)
                            return (
                              <button key={q} type="button" onClick={() => togglePredictionQuality(q)}>
                                <Badge variant={active ? "default" : "outline"} className="cursor-pointer text-sm">
                                  {q}
                                </Badge>
                              </button>
                            )
                          })}
                        </div>
                      </FilterSection>
                    </div>
                  )}

                  {/* Versão da previsão (prompt_version da previsão ativa). */}
                  {showSynopsisState && predictionVersionOptions.length > 0 && (
                    <div className="sm:grow sm:shrink-0">
                      <FilterSection title="Versão da previsão">
                        <div className="flex flex-wrap items-center gap-1">
                          {predictionVersionOptions.map((v) => {
                            const active = draft.predV.includes(v)
                            return (
                              <button key={v} type="button" onClick={() => togglePredictionVersion(v)}>
                                <Badge variant={active ? "default" : "outline"} className="cursor-pointer text-xs">
                                  {v}
                                  {v === currentPromptVersion ? " (atual)" : ""}
                                </Badge>
                              </button>
                            )
                          })}
                        </div>
                      </FilterSection>
                    </div>
                  )}

                  {/* Δ Previsto × atual = nível previsto − nível atual (manual/desconhecido), range -3..+3. */}
                  {showSynopsisState && (
                    <div className="sm:grow sm:shrink-0">
                      <FilterSection title="Δ Previsto × atual">
                        <div className="flex flex-wrap items-center gap-1">
                          {DELTA_OPTIONS.map((opt) => {
                            const active = draft.predD.includes(opt.id)
                            return (
                              <button key={opt.id} type="button" onClick={() => togglePredictionDelta(opt.id)}>
                                <Badge variant={active ? "default" : "outline"} className="cursor-pointer text-xs tabular-nums">
                                  {opt.label}
                                </Badge>
                              </button>
                            )
                          })}
                        </div>
                      </FilterSection>
                    </div>
                  )}

                  {showDataFilters && (
                    <div className="sm:grow sm:shrink-0">
                      <FilterSection title="Dados (nº)">
                        <div className="flex flex-wrap items-start gap-3">
                          <NumRange label="tags" min={draft.minTags} max={draft.maxTags} onMin={setMinTags} onMax={setMaxTags} onEnter={apply} />
                          <NumRange label="reviews úteis" min={draft.minReviews} max={draft.maxReviews} onMin={setMinReviews} onMax={setMaxReviews} onEnter={apply} />
                        </div>
                      </FilterSection>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

/** Igualdade de conjunto (ordem-independente) — pro clean-URL do filtro de status. */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

const parseCount = (v: string) => Math.max(0, Math.floor(Number(v) || 0))

function NumRange({
  label,
  min,
  max,
  onMin,
  onMax,
  onEnter,
}: {
  label: string
  min: number
  max: number
  onMin: (n: number) => void
  onMax: (n: number) => void
  onEnter: () => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          step={1}
          value={min || ""}
          placeholder="mín"
          onChange={(e) => onMin(parseCount(e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter() }}
          className="h-7 w-16 tabular-nums"
          aria-label={`${label} mínimo`}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          value={max || ""}
          placeholder="máx"
          onChange={(e) => onMax(parseCount(e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter() }}
          className="h-7 w-16 tabular-nums"
          aria-label={`${label} máximo`}
        />
      </div>
    </div>
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
