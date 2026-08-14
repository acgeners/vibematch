"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useTransition } from "react"
import type { CSSProperties, ReactNode } from "react"
import { INTEREST_NONE } from "@/lib/interest-sentinels"
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronUp, Filter, Info, Loader2, Minus, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { getPersonalStatusDescription } from "@/lib/constants/personal-status-descriptions"
import { LABELS } from "@/lib/constants/ui-labels"
import { CRITERION_SLUGS, SYNOPSIS_QUALITIES, DEFAULT_CRITERION_SCORE_PRESETS } from "@/types/domain"
import {
  fmtSigma,
  readCriterionUnit,
  scoreToSigma,
  sigmaDomain,
  sigmaToScore,
  snapToScoreGrid,
  SCORE_GRID,
  SD_PRESETS,
  SD_STEP,
} from "@/lib/ranking/criterion-unit"
import type { CriterionMoments, CriterionUnit } from "@/lib/ranking/criterion-unit"
import { MY_RANGE_STEPS, myRangeParams, ownedSlugs, readMyRangeState } from "@/lib/ranking/my-range"
import type { IdealRange } from "@/lib/ranking/my-range"
import type { CriterionScorePresets } from "@/types/domain"
import { useCollapsedFilters } from "@/lib/use-collapsed-filters"
import { saveFilterPreset, renameFilterPreset, deleteFilterPreset } from "@/server/actions/filter-presets"
import { TERMINAL_PERSONAL_STATUSES } from "@/lib/constants/criteria"
import { UNREAD_PERSONAL_STATUSES } from "@/lib/constants/criteria"
import { STATUS_FILTER_PARAMS, setStatusRule } from "@/lib/status-filter-toggle"
import type { StatusFilterKind, StatusRule } from "@/lib/status-filter-toggle"
import { DEFAULT_TIER_BAND_WIDTH } from "@/lib/ranking/tier-config"
import { ActiveFilterChips } from "@/components/ranking/active-filter-chips"
import { CollapseIconTrigger, CollapseTitleTrigger } from "@/components/ui/collapse-trigger"
import type { ActiveFilterChip, ActiveFilterValue } from "@/components/ranking/active-filter-chips"
import { ART_FILTER_CHIP_LABELS, ART_FILTER_PARAM, parseArtFilter } from "@/lib/arte/url"

interface SavedFilterPreset {
  id: string
  name: string
  query: string
}

const CRITERION_LABELS: Record<string, string> = {
  romance: "Romance",
  couple_dynamics: "Casal",
  fantasy_nobility: "Fantasia/Nobreza",
  action_adventure: "Ação/Aventura",
  adult_content: "Conteúdo adulto",
  protagonist: "Protagonista",
  humor: "Humor",
  drama: "Drama",
  tragedy: "Tragédia",
}

/**
 * Opções de ordenação AGRUPADAS — 26 itens numa lista corrida não davam pra
 * varrer. Os três primeiros grupos são os mesmos do seletor de colunas
 * (`WORK_COLUMN_GROUP_LABELS`: Básico/Notas/Atributos), de propósito: quem
 * aprendeu onde está "Veredito" ali acha aqui no mesmo lugar.
 *
 * "Recomendação" é o único grupo próprio — `recommended` e `decision` não são
 * coluna nem atributo, são a régua de ordem da própria página.
 */
const SORTABLE_FIELD_GROUPS: Array<{ label: string; fields: Array<{ value: string; label: string }> }> = [
  {
    label: "Recomendação",
    fields: [
      { value: "recommended", label: "Recomendado" },
      { value: "decision", label: LABELS.decision.short },
    ],
  },
  {
    label: "Notas",
    fields: [
      { value: "expected_score", label: LABELS.expected_score.short },
      { value: "personal_fit", label: LABELS.personal_fit.short },
      { value: "alignment_score", label: LABELS.alignment_score.short },
      { value: "platform_avg", label: LABELS.platform_avg.short },
      { value: "total_votes", label: LABELS.total_votes.short },
      { value: "synopsis_q", label: LABELS.synopsis_q.short },
      { value: "synopsis_pred", label: LABELS.synopsis_pred.short },
      // Ordena pelo PERCENTIL da estimativa. "(est.)" no rótulo é obrigatório: sem ele, a
      // opção promete uma nota de arte que não existe.
      { value: "art", label: "Arte (est.)" },
    ],
  },
  {
    label: "Básico",
    fields: [
      { value: "title", label: LABELS.title.short },
      { value: "chapters", label: LABELS.chapters_total.short },
      { value: "chapters_read", label: LABELS.chapters_read.short },
      { value: "year", label: LABELS.year.short },
      { value: "publication_status", label: LABELS.publication_status.short },
      { value: "personal_status", label: LABELS.personal_status.short },
      { value: "updated_at", label: LABELS.updated_at.short },
      { value: "last_read_at", label: LABELS.last_read_at.short },
    ],
  },
  {
    label: "Atributos",
    fields: CRITERION_SLUGS.map((slug) => ({
      value: `crit_${slug}`,
      label: CRITERION_LABELS[slug] ?? slug,
    })),
  },
]

/** Achatado — o parse/validação da URL não conhece grupo, só o conjunto de campos.
 *  Derivado dos grupos (e não uma 2ª lista) pra um campo novo não poder existir
 *  num lugar e faltar no outro. */
const SORTABLE_FIELDS: Array<{ value: string; label: string }> = SORTABLE_FIELD_GROUPS.flatMap((g) => g.fields)

const SORT_FIELD_LABEL: Record<string, string> = Object.fromEntries(
  SORTABLE_FIELDS.map((f) => [f.value, f.label]),
)

// Personal statuses sempre ocultos no ranking = os TERMINAIS (a leitura acabou).
// A lista vem do banco (`personal_status.is_terminal`), não de nomes escritos à mão.
const HIDDEN_PERSONAL_STATUSES = new Set<string>(TERMINAL_PERSONAL_STATUSES)

interface SortLevel {
  field: string
  dir: "asc" | "desc"
}

const DEFAULT_SORT = "expected_score:desc"

function parseSortLevels(raw: string | null, defaultSort: string = DEFAULT_SORT): SortLevel[] {
  const src = raw ?? defaultSort
  return src.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    const validField = SORTABLE_FIELDS.some((f) => f.value === field) ? field : "expected_score"
    return { field: validField, dir: dir === "asc" ? "asc" : "desc" }
  })
}

function encodeSortLevels(levels: SortLevel[]): string {
  return levels.map((l) => `${l.field}:${l.dir}`).join(",")
}

interface SortLevelsSectionProps {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  className?: string
  defaultSort?: string
}

function SortLevelsSection({ searchParams, updateParams, className, defaultSort }: SortLevelsSectionProps) {
  const rawSort = searchParams.get("sort")
  const levels = parseSortLevels(rawSort, defaultSort)

  const setLevels = (next: SortLevel[]) => {
    updateParams({ sort: encodeSortLevels(next) })
  }

  const updateField = (i: number, field: string) => {
    const next = levels.map((l, idx) => idx === i ? { ...l, field } : l)
    setLevels(next)
  }

  const toggleDir = (i: number) => {
    const next = levels.map((l, idx) => idx === i ? { ...l, dir: l.dir === "desc" ? "asc" : "desc" } : l) as SortLevel[]
    setLevels(next)
  }

  const remove = (i: number) => {
    const next = levels.filter((_, idx) => idx !== i)
    setLevels(next.length ? next : [{ field: "expected_score", dir: "desc" }])
  }

  const add = () => {
    if (levels.length >= 5) return
    const used = new Set(levels.map((l) => l.field))
    const next = SORTABLE_FIELDS.find((f) => !used.has(f.value))
    setLevels([...levels, { field: next?.value ?? "calc_score", dir: "desc" }])
  }

  return (
    <FilterSection
      title="Ordenação"
      className={className}
      headerAction={
        <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
          {levels.length} {levels.length === 1 ? "nível" : "níveis"}
        </span>
      }
    >
      {/* TRILHA de prioridade, não pilha. Cada nível é um chip e a ordem da
          esquerda pra direita É o desempate — o "›" diz isso melhor que "1. 2. 3.".
          A pilha antiga custava +52px de altura POR NÍVEL (medido: 201px com 2,
          ~357px com 5), e esticava a linha inteira do painel; a trilha quebra
          linha só quando precisa. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {levels.map((level, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-[11px] leading-none text-muted-foreground/70">
                ›
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border py-0.5 pl-2 pr-1 transition-colors",
                // O nível 1 é o que de fato ordena; os demais só desempatam.
                i === 0
                  ? "border-primary/45 bg-primary/10"
                  : "border-border/70 bg-card/60",
              )}
            >
              <Select value={level.field} onValueChange={(v) => updateField(i, v)}>
                <SelectTrigger
                  size="sm"
                  aria-label={`Nível ${i + 1} de ordenação`}
                  className="h-6 w-fit gap-1 border-0 bg-transparent px-1 text-xs shadow-none hover:bg-transparent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SortFieldOptions />
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => toggleDir(i)}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={level.dir === "desc" ? "Decrescente" : "Crescente"}
                aria-label={`${SORT_FIELD_LABEL[level.field] ?? level.field}: ordem ${level.dir === "desc" ? "decrescente" : "crescente"}`}
              >
                {level.dir === "desc"
                  ? <ArrowDown className="h-3 w-3" />
                  : <ArrowUp className="h-3 w-3" />}
              </button>
              {/* Some quando é o último nível — botão que não pode agir lê como
                  quebrado, e "remover o único critério de ordem" não existe. */}
              {levels.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remover ordenação por ${SORT_FIELD_LABEL[level.field] ?? level.field}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          </div>
        ))}
        {levels.length < 5 && (
          <button type="button" onClick={add}>
            <Badge
              variant="outline"
              className="cursor-pointer rounded-full border-dashed px-2.5 py-0.5 text-xs font-normal text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
            >
              + nível
            </Badge>
          </button>
        )}
      </div>
    </FilterSection>
  )
}

/**
 * "Dentro do meu range" — atalho que preenche os nove limiares por atributo com
 * as faixas ideais do perfil. Ver `lib/ranking/my-range.ts` pro porquê de ele
 * escrever na URL em vez de ter parâmetro próprio.
 *
 * Só é renderizado quando há faixas (`ranges` não vazio) — mesma condição do
 * modo de cor "Minha faixa" na tabela, que é o outro consumidor desse dado.
 */
function MyRangeToggle({
  ranges,
  searchParams,
  updateParams,
}: {
  ranges: Record<string, IdealRange>
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
}) {
  const state = readMyRangeState(searchParams, ranges)
  const owned = ownedSlugs(ranges)
  if (owned.length === 0) return null

  const apply = (tolerance: number | null) => {
    // Clicar no degrau já ativo é no-op. Sem isso, reclicar "Desligado" limparia
    // limiares que a pessoa tinha posto à mão nos mesmos atributos.
    if (state === tolerance) return
    updateParams(myRangeParams(ranges, tolerance))
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
              Meu range
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Filtra pelas faixas ideais do seu perfil de gosto — o mesmo dado que pinta as células no
            modo de cor “Minha faixa”. Preenche os limiares dos {owned.length} atributos abaixo, então
            você pode afrouxar um deles depois.
          </TooltipContent>
        </Tooltip>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            onClick={() => apply(null)}
            aria-pressed={state === null}
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] transition-colors",
              state === null
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Desligado
          </button>
          {MY_RANGE_STEPS.map((step) => (
            <Tooltip key={step.tolerance}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => apply(step.tolerance)}
                  aria-pressed={state === step.tolerance}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                    state === step.tolerance
                      ? "bg-card font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {step.label}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{step.hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Estado "custom": há limiares nos atributos do range, mas afrouxados à
            mão. Nenhum botão marcado seria mudo — o rótulo diz por que. */}
        {state === "custom" && (
          <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
            ajustado
          </span>
        )}
      </div>
    </TooltipProvider>
  )
}

/** Itens do seletor de ordenação, agrupados. Componente próprio porque a mesma
 *  lista é aberta uma vez por chip da trilha. */
function SortFieldOptions() {
  return (
    <>
      {SORTABLE_FIELD_GROUPS.map((group) => (
        <SelectGroup key={group.label}>
          <SelectLabel className="text-[10px] uppercase tracking-wider">{group.label}</SelectLabel>
          {group.fields.map((f) => (
            <SelectItem key={f.value} value={f.value} className="text-xs">
              {f.label}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  )
}

interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  comment: string | null
}

interface RankingFiltersProps {
  availableGenres: string[]
  /** Mapa name → cat_type ('category' | 'demographics') da tabela genres. Quando
   *  presente, a aba Gêneros separa Demografia (topo) de Gêneros. /ranking passa;
   *  outras páginas omitem → grid único (comportamento antigo). */
  genreCatTypes?: Record<string, string>
  /** Mostra o segmentado "Esconder tags evitadas" (?hide_avoided=strong|all).
   *  Ausente/false = o controle não aparece (páginas que não parseiam o param).
   *
   *  ⚠️ Era um objeto com 3 URLs prontas, e o controle navegava por `<Link>` — o
   *  ÚNICO do painel fora do rascunho. Como `draftSearch` só é semeado no 1º
   *  render, a navegação por fora deixava o rascunho sem `hide_avoided`, e o
   *  "Aplicar filtros" seguinte reescrevia a URL SEM ele: o filtro que a pessoa
   *  acabara de marcar sumia sem erro, com cara de "não aplicou". */
  showHideAvoided?: boolean
  availableTags: Array<{ slug: string; name: string; tag_group_id?: string | null; groupName?: string; subGroupName?: string; subGroupSlug?: string }>
  publicationStatuses?: StatusOption[]
  personalStatuses?: StatusOption[]
  /** Status assumido quando `?pub_status` está ausente da URL — governa tanto quais
   *  chips aparecem MARCADOS quanto o efeito de clicar num chip. Omitido = `["Completed"]`
   *  (comportamento histórico de /ranking, onde a ausência do parâmetro É um filtro real
   *  no servidor). Passe `"all"` em páginas onde a ausência já significa "sem filtro" lá
   *  (ex.: favoritos) — senão o painel mostra "Completed" marcado enquanto a lista mostra
   *  tudo, e o contador/"Filtros ativos" mente sobre o que está de fato aplicado. */
  defaultPublicationStatus?: string[] | "all"
  /** Idem para `?per_status`. Omitido = `UNREAD_PERSONAL_STATUSES` (Want to Read + Untracked). */
  defaultPersonalStatus?: string[] | "all"
  defaultTopN: number | null
  basePath?: string
  /**
   * Sort default efetivo (definido em app/ranking/page.tsx conforme o plano):
   * ambos os planos = `expected_score:desc` (forma tiers), com nível secundário
   * Free=`personal_fit:desc` / Pago=`alignment_score:desc`. ("recommended" é um sort
   * OPT-IN, não o default — e desde #12 também forma tiers.)
   */
  defaultSort?: string
  /** Conjuntos de filtros salvos do usuário para esta página (base_path). */
  savedPresets?: SavedFilterPreset[]
  /** Largura de tier padrão (formula_config.tier_band_width) — controle movido pra dentro do filtro. */
  defaultBand?: number
  /** Atalhos ≥ configuráveis da aba Notas (migration 132). Ausente = default [5,6,7,8]. */
  criterionPresets?: CriterionScorePresets
  /**
   * Média/σ dos 9 atributos no catálogo — habilita a lente σ do filtro de
   * critério. Três estados, e eles são distintos de propósito:
   * `undefined` = a página não oferece a lente (ex: /favorites, que não busca os
   * momentos) → o seletor nem aparece; `null` = oferece, mas a leitura falhou →
   * seletor desabilitado, com a explicação; preenchido = lente disponível.
   */
  criterionMoments?: CriterionMoments | null
  /**
   * Faixas ideais por atributo do perfil de gosto — habilita o segmentado
   * "Meu range" no cabeçalho de Notas por critério. É o MESMO dado que a tabela
   * usa no modo de cor "Minha faixa" (`getCriterionColorRanges`), passado das
   * duas pontas pela página. Ausente/vazio = sem perfil → o controle não aparece
   * (igual ao toggle de cor, que também some).
   */
  criterionRanges?: Record<string, IdealRange>
  /** Confiança do público (pseudo_votes_nota_m): acima desse nº de votos a média
   *  externa pesa ≥50% na Nota Prevista. Marca o limiar "confiável" no filtro de votos. */
  confidenceVotes?: number | null
  /** Controles de tuning exclusivos do /ranking: "Obras exibidas" (top_n) e "Largura
   *  dos tiers" (band). Favoritos passa false — lá não têm efeito (mostra todas as
   *  obras do recorte e não forma tiers), então só confundiriam. Default = exibe. */
  showTopN?: boolean
  showTierBand?: boolean
  /** Mostra o segmentado "Conteúdo 18+" (?adult=). Passe true SÓ onde a página
   *  realmente parseia `?adult` — hoje /ranking e /favorites (as duas leem
   *  `adultFilter` e repassam ao getRanking). Ligar numa página que não parseia dá
   *  um controle que marca e não filtra, sem erro nenhum.
   *  (Esta linha já disse "só /ranking"; o /favorites passou a parsear e ela ficou
   *  para trás — confira na página antes de confiar.) */
  /**
   * Mostra o segmentado "Arte (estimada)" (?art=forte|sem_fraca).
   *
   * 🔴 Gate por DONO, e não por preferência: a estimativa de arte é treinada nos rótulos
   * `like_art_score` DELE, então `art_percentile` chega null pelo overlay para todo mundo
   * mais. Sem o gate, um visitante veria o controle e o "Forte" devolveria lista vazia — que
   * é indistinguível de "não existe obra com arte forte".
   *
   * ⚠️ `isOwner` é o proxy CERTO hoje e ERRADO amanhã: quando o recalc per-user aprender a
   * estimar arte, isto vira "tem modelo de arte", como `PERSONAL_SORT_FIELDS` já faz.
   */
  showArtFilter?: boolean
  showAdultFilter?: boolean
}

interface FilterSectionProps {
  title: string
  defaultOpen?: boolean
  headerAction?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

function FilterSection({
  title,
  headerAction,
  children,
  className,
  contentClassName,
}: FilterSectionProps) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border/65 bg-background/45 ${className ?? ""}`}>
      <div className="flex min-h-[40px] sm:min-h-[46px] items-center justify-between gap-3 bg-card/60 px-3 py-2.5 transition-colors hover:bg-card/80 sm:px-4 sm:py-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      <div className={`border-t border-border/60 px-3 py-3 sm:px-4 sm:py-4 xl:px-5 xl:py-5 ${contentClassName ?? ""}`}>
        {children}
      </div>
    </div>
  )
}

const VOTES_PRESETS: Array<{ label: string; min: number | null }> = [
  { label: "Qualquer", min: null },
  { label: "≥100", min: 100 },
  { label: "≥500", min: 500 },
  { label: "≥1k", min: 1000 },
  { label: "≥5k", min: 5000 },
  { label: "≥10k", min: 10000 },
]

function formatVotes(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

function num(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

// ============================================================================
// Redesign dos filtros: toggles de Interesse com tons distintos (Manual = rosa /
// Prev. IA = salmão), controle de Largura dos tiers embutido, e a grade de
// "pills" de nota (grade fixa + editor que abre abaixo do grupo).
// ============================================================================

/** Toggles ♥ do Interesse — tom rosa (manual) ou salmão (Prev. IA). */
function QualityToggles({
  values,
  selected,
  onToggle,
  tone,
  extra,
}: {
  values: readonly string[]
  selected: Set<string>
  onToggle: (v: string) => void
  tone: "rose" | "salmon"
  /** Chip que não é um ♥ (o travessão "sem avaliação"), no mesmo container para quebrar junto. */
  extra?: ReactNode
}) {
  const base = tone === "rose" ? "text-red-500" : "text-orange-500"
  const onCls =
    tone === "rose"
      ? "border-red-500/60 bg-red-500/15 text-red-500"
      : "border-orange-500/60 bg-orange-500/15 text-orange-500"
  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.map((q) => {
        const on = selected.has(q)
        return (
          <button
            key={q}
            type="button"
            onClick={() => onToggle(q)}
            aria-pressed={on}
            className={`inline-flex h-8 items-center justify-center rounded-full border px-2 text-xs font-semibold tracking-tight transition-colors ${
              on ? onCls : `border-border/70 bg-background/45 hover:border-border ${base}`
            }`}
          >
            <span className="text-[13px] leading-none tracking-[0.06em]">{q}</span>
          </button>
        )
      })}
      {extra}
    </div>
  )
}

/**
 * Chip da ausência de nota, ao lado dos ♥.
 *
 * É um **Ø**, não a palavra: escrito por extenso ele empurrava os ♥ para uma segunda linha.
 * Dois símbolos foram descartados, e por motivos diferentes:
 * - **traço/`Minus`**: neste MESMO painel ele já é a ação "excluir (NOT)" das abas Gêneros
 *   e Tags (ver FacetLegend). O mesmo desenho significaria "inclua as sem nota" aqui e
 *   "tire estas" ali.
 * - **♡**: no QualityHearts o coração vazio é "posição não preenchida DENTRO da nota"
 *   (a escala mostra sempre 4). Leria como nota zero, não como "não avaliada".
 *
 * O que ele quer dizer vai no aria-label e no tooltip, e por extenso na barra de filtros
 * ativos — o símbolo sozinho nunca é a única pista.
 */
function InterestOtherToggle({
  active,
  onToggle,
  label,
  tone,
}: {
  active: boolean
  onToggle: () => void
  /** Texto por extenso: vira aria-label e tooltip (ex.: "Sem avaliação"). */
  label: string
  tone: "rose" | "salmon"
}) {
  const onCls =
    tone === "rose"
      ? "border-red-500/60 bg-red-500/15 text-red-500"
      : "border-orange-500/60 bg-orange-500/15 text-orange-500"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold leading-none transition-colors ${
        active ? onCls : "border-border/70 bg-background/45 text-muted-foreground hover:border-border"
      }`}
    >
      <span aria-hidden>Ø</span>
    </button>
  )
}

/**
 * Alterna como o Interesse Manual e a Previsão IA se combinam: "OU" (a obra
 * casa se bater qualquer um dos dois) ou "E" (precisa bater os dois). Só tem
 * efeito quando os DOIS têm seleção — fora disso fica esmaecido.
 */
function InterestModeToggle({
  mode,
  onChange,
  active,
}: {
  mode: "and" | "or"
  onChange: (mode: "and" | "or") => void
  active: boolean
}) {
  const seg = (on: boolean) =>
    `inline-flex h-7 items-center rounded px-3 text-xs font-semibold transition-colors ${
      on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
    }`
  return (
    <div
      className={`inline-flex rounded-md border border-border/70 bg-background/60 p-0.5 transition-opacity ${active ? "" : "opacity-50"}`}
      title={active ? undefined : "Só se aplica quando Manual e Prev. IA têm seleção"}
    >
      <button
        type="button"
        onClick={() => onChange("or")}
        aria-pressed={mode === "or"}
        className={seg(mode === "or")}
        title="Casa se bater o Interesse manual OU a previsão IA"
      >
        OU
      </button>
      <button
        type="button"
        onClick={() => onChange("and")}
        aria-pressed={mode === "and"}
        className={seg(mode === "and")}
        title="Casa só se bater o Interesse manual E a previsão IA"
      >
        E
      </button>
    </div>
  )
}

/**
 * As larguras oferecidas são as que foram MEDIDAS, e o número medido vai no `title`.
 *
 * A régua é a honestidade pairwise: dos pares que a banda declara equivalentes, quantos
 * a Nota Prevista teria ordenado corretamente? ~50% = agrupar é honesto; muito acima =
 * a banda joga fora sinal que existia (medição de 2026-08-06 sobre as 206 obras com
 * nota do usuário — ver `lib/ranking/tier-config.ts`).
 *
 * ⚠️ A lista anterior era `0,3 · 0,4 · 0,6 · 0,8`, simétrica em torno do padrão de
 * então (0,5). Com o padrão no valor medido (0,25), metade dela ficava ACIMA da faixa
 * honesta — e 0,6/0,8 nem chegaram a ser medidos: o pior valor da tabela é 0,73, já
 * "claramente errado". Oferecer um degrau é recomendá-lo; recomendar só o que tem
 * número atrás.
 */
const TIER_BAND_OPTIONS: ReadonlyArray<{ band: number; medido: string }> = [
  { band: 0.2, medido: "52,7% dos pares ordenáveis (honesto, mas começa a estilhaçar)" },
  { band: 0.3, medido: "53,8% dos pares ordenáveis (honesto)" },
  { band: 0.35, medido: "55,0% dos pares ordenáveis (limítrofe)" },
  { band: 0.5, medido: "57,9% dos pares ordenáveis — jogava fora sinal (padrão antigo)" },
]

/** Largura dos tiers — movido pra dentro do filtro (draft; aplica com "Aplicar filtros"). */
function TierBandSection({
  searchParams,
  updateParams,
  defaultBand,
  className,
  contentClassName,
}: {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  defaultBand: number
  className?: string
  contentClassName?: string
}) {
  const active = searchParams.get("band")
  /**
   * Até 2 casas, sem zero à toa: 0,3 · 0,5 · 0,55.
   * ⚠️ Arredondar para 1 casa fixa mentiria: `defaultBand` vem do banco
   * (formula_config.tier_band_width) e pode ser 0,55 — que viraria "0,6", o rótulo de
   * OUTRO chip da mesma linha.
   */
  const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, "").replace(".", ",")
  // Altura única: o chip do padrão tem duas linhas, e sem isto os numéricos ficariam
  // mais baixos que ele na mesma fileira.
  const chip = (on: boolean) =>
    `inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs font-semibold tabular-nums transition-colors ${
      on
        ? "border-primary/45 bg-primary/10 text-primary"
        : "border-border/70 bg-background/45 text-muted-foreground hover:border-border hover:text-foreground"
    }`
  return (
    <FilterSection title="Largura dos tiers" className={className} contentClassName={contentClassName}>
      {/* Duas colunas separadas por divisória — mesmo idioma de "Combinar" (Interesse) e
          "Obras exibidas" (Critérios gerais): à esquerda as opções, à direita o padrão.
          Ele saiu da fileira porque NÃO é mais um valor entre os outros: é "deixa como
          está no banco", e antes ocupava a posição numérica do próprio valor, o que o
          fazia parecer só mais um degrau da escala. */}
      {/* `1fr auto 1fr` põe a divisória no centro geométrico do card e dá a mesma metade
          para cada lado — com flex + justify-between ela encostava no bloco mais largo. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => updateParams({ band: null })}
            className={chip(active == null)}
            title={`Usa o valor salvo no banco (${fmt(defaultBand)})`}
          >
            {/* Valor em cima, "(Padrão)" embaixo e menor: numa linha só ("Padrão (0,50)")
                o rótulo era 2× mais largo que os outros chips. */}
            <span className="flex flex-col items-center gap-0.5 leading-none">
              <span>{fmt(defaultBand)}</span>
              <span className="text-[10px] font-medium opacity-75">(Padrão)</span>
            </span>
          </button>
        </div>
        <div className="w-px bg-border/60" />
        <div className="flex items-center justify-center">
          <div className="grid grid-cols-2 gap-1.5">
            {TIER_BAND_OPTIONS
              // Sem repetir o chip do próprio padrão: com defaultBand = 0,3 haveria "0,3"
              // dos dois lados da divisória, um deles gravando ?band= e o outro limpando.
              .filter((o) => o.band !== defaultBand)
              .map((o) => (
                <button
                  key={o.band}
                  type="button"
                  onClick={() => updateParams({ band: String(o.band) })}
                  className={chip(active === String(o.band))}
                  title={`Agrupa no mesmo tier obras a até ${fmt(o.band)} de distância na nota — ${o.medido}`}
                >
                  {fmt(o.band)}
                </button>
              ))}
          </div>
        </div>
      </div>
    </FilterSection>
  )
}

// ---- Grade de pills de nota (aba Notas) ----

type ScoreDef = {
  key: string
  emoji: string
  label: string
  minKey: string
  maxKey: string
  min: number
  max: number
  step: number
  presets: number[]
  kind?: "votes"
  fullWidth?: boolean
  /**
   * Unidade de EXIBIÇÃO/EDIÇÃO. Ausente = pontos. "sd" = o controle mostra e
   * edita em desvios-padrão contra a média do catálogo.
   *
   * 🔴 A URL guarda SEMPRE pontos, em qualquer unidade. σ é uma lente, não um
   * formato de armazenamento — e é isso que mantém todo consumidor correto sem
   * saber que σ existe: `getRanking`, os presets salvos
   * (`ranking_filter_presets` guarda a query crua) e o
   * `parseFiltersFromSearchParams` do diálogo de recomendação, que lê a URL do
   * /ranking pra montar o universo de candidatos. Guardar σ na URL fazia
   * `min_romance=-0.5` virar "romance ≥ −0,5 PONTOS" lá — isto é, filtro
   * nenhum, sem erro e com resultado.
   *
   * Corolário de graça: trocar a unidade não mexe em nenhum valor, então NUNCA
   * muda o resultado — vira só outra forma de ler o mesmo limiar.
   */
  unit?: "sd"
  /** Momentos do atributo — sem eles não há conversão, e o pill fica em pontos. */
  moment?: { mean: number; sd: number }
  /** Texto do ⓘ ao lado do rótulo do filtro (explica o que a métrica é). */
  help?: string
}

/** Segmentado Pontos | σ do cabeçalho de "Notas por critério". */
function CriterionUnitToggle({
  unit,
  updateParams,
  moments,
}: {
  unit: CriterionUnit
  // Sem `searchParams` de propósito: o toggle não LÊ limiar nenhum porque não
  // reescreve limiar nenhum — trocar de unidade é inócuo por construção.
  updateParams: (updates: Record<string, string | null>) => void
  moments: CriterionMoments | null | undefined
}) {
  const seg = (active: boolean) =>
    cn(
      "inline-flex h-6 items-center rounded px-2 text-[11px] font-medium transition-colors",
      active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
    )
  const toggle = (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border/65 bg-background/60 p-0.5">
      <button
        type="button"
        onClick={() => updateParams({ crit_unit: null })}
        aria-pressed={unit === "points"}
        className={seg(unit === "points")}
      >
        Pontos
      </button>
      <button
        type="button"
        onClick={() => updateParams({ crit_unit: "sd" })}
        aria-pressed={unit === "sd"}
        className={seg(unit === "sd")}
        disabled={!moments}
      >
        &sigma;
      </button>
    </div>
  )
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{toggle}</TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {moments
            ? "\u03c3 mede o limiar em desvios-padr\u00e3o contra a m\u00e9dia do catálogo, e n\u00e3o em pontos. \u201cRomance \u2265 7\u201d pega 55% do acervo (a m\u00e9dia j\u00e1 \u00e9 7,4); \u201cHumor \u2265 7\u201d pega 3,5%. Em \u03c3 os dois querem dizer a mesma coisa: quanto acima do normal daquele atributo."
            : "Indispon\u00edvel: as m\u00e9dias do cat\u00e1logo n\u00e3o puderam ser lidas agora."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Presets ≥ configuráveis (migration 132): overrides[slug] ?? default. As demais
// páginas (ex: /favorites) omitem a prop → cai no default hardcoded [5,6,7,8].
function buildCriterionScoreDefs(
  presets: CriterionScorePresets,
  unit: CriterionUnit,
  moments: CriterionMoments | null | undefined,
): ScoreDef[] {
  return CRITERION_SLUGS.map((slug) => {
    const base = {
      key: slug,
      emoji: CRITERIA_INFO[slug]?.emoji ?? "",
      label: CRITERION_LABELS[slug] ?? slug,
      minKey: `min_${slug}`,
      maxKey: `max_${slug}`,
    }
    // Atributo sem momento (σ = 0, ou leitura falhou) fica em PONTOS mesmo com a
    // lente ligada: sem conversão possível, mostrar σ seria inventar número.
    const moment = moments?.[slug]
    if (unit === "sd" && moment && moment.sd > 0) {
      // Domínio DERIVADO dos momentos (a imagem em σ de 0–10). Faixa fixa deixava
      // limiares legítimos fora do slider, e o commit os apagava — ver sigmaDomain.
      const domain = sigmaDomain(moment)
      return {
        ...base,
        min: domain.min,
        max: domain.max,
        step: SD_STEP,
        // Preset acima do teto do atributo é promessa que a escala não cumpre:
        // em fantasia/nobreza (média 7,27) o "+2σ" já passaria de nota 10.
        presets: SD_PRESETS.filter((p) => p <= domain.max),
        unit: "sd" as const,
        moment,
      }
    }
    return {
      ...base,
      min: 0,
      max: 10,
      step: 1,
      presets: presets.overrides[slug] ?? presets.default,
    }
  })
}

const GENERAL_SCORE_DEFS: ScoreDef[] = [
  { key: "expected", emoji: "🎯", label: LABELS.expected_score.full, minKey: "min_expected", maxKey: "max_expected", min: 0, max: 10, step: 0.5, presets: [6, 7, 7.5, 8] },
  { key: "fit", emoji: "🧭", label: LABELS.personal_fit.full, minKey: "min_fit", maxKey: "max_fit", min: 0, max: 100, step: 5, presets: [50, 75, 90] },
  { key: "platform", emoji: "🌐", label: LABELS.platform_avg.full, minKey: "min_platform_avg", maxKey: "max_platform_avg", min: 0, max: 10, step: 0.5, presets: [6, 7, 8] },
  { key: "align", emoji: "🤖", label: LABELS.alignment_score.full, minKey: "min_align", maxKey: "max_align", min: 0, max: 100, step: 5, presets: [50, 75, 90] },
  { key: "votes", emoji: "🗳️", label: LABELS.total_votes.full, minKey: "min_votes", maxKey: "max_votes", min: 0, max: 0, step: 1, presets: [], kind: "votes", fullWidth: true, help: "Soma dos votos das plataformas externas (MyAnimeList, AniList, Kitsu…) — o tamanho da amostra da opinião pública. Quanto mais votos, mais a média do público pesa na Nota Prevista; abaixo do limiar de confiança (marcado ✓ nos presets) a nota é puxada pra IA. Filtrar acima dele deixa só as obras onde a nota externa é estatisticamente confiável." },
]

function scoreDecimals(step: number): number {
  return step < 1 ? (step.toString().split(".")[1]?.length ?? 1) : 0
}
function fmtScore(def: ScoreDef, v: number): string {
  if (def.kind === "votes") return formatVotes(v)
  if (def.unit === "sd") return fmtSigma(v)
  return v.toFixed(scoreDecimals(def.step))
}

/**
 * Pontos (como está na URL) → domínio de EXIBIÇÃO do controle. Identidade em
 * pontos; σ quando a lente está ligada e o atributo tem momentos.
 */
function toDisplay(def: ScoreDef, points: number | undefined): number | undefined {
  if (points == null) return undefined
  if (def.unit !== "sd") return points
  return scoreToSigma(points, def.moment) ?? undefined
}

/**
 * Domínio de exibição → pontos, que é o que vai pra URL.
 *
 * Encaixa na grade de 0,5 (o passo real das notas) porque um limiar fracionário
 * faz o pill em Pontos mentir: `+0,5σ` em romance dá 8,01, o pill mostra "≥ 8" e
 * o filtro exclui as 421 obras com romance exatamente 8,0. Ver snapToScoreGrid.
 */
function toPoints(def: ScoreDef, display: number, bound: "min" | "max"): number | null {
  if (def.unit !== "sd") return display
  const p = sigmaToScore(display, def.moment)
  return p == null ? null : snapToScoreGrid(p, bound)
}

/** Estado/rótulo atual de uma nota: Qualquer / ≥X / X–Y / ≤X. */
function scoreValueInfo(def: ScoreDef, searchParams: Pick<URLSearchParams, "get">) {
  const rawMin = searchParams.get(def.minKey)
  const rawMax = searchParams.get(def.maxKey)
  const hasMin = rawMin != null && rawMin !== ""
  const hasMax = rawMax != null && rawMax !== ""
  const vMin = toDisplay(def, num(rawMin))
  const vMax = toDisplay(def, num(rawMax))
  let label = "Qualquer"
  if (hasMin && hasMax && vMin != null && vMax != null) label = `${fmtScore(def, vMin)}–${fmtScore(def, vMax)}`
  else if (hasMin && vMin != null) label = `≥ ${fmtScore(def, vMin)}`
  else if (hasMax && vMax != null) label = `≤ ${fmtScore(def, vMax)}`
  return { hasMin, hasMax, vMin, vMax, active: hasMin || hasMax, maxOnly: hasMax && !hasMin, label }
}

function editorChip(on: boolean): string {
  return `inline-flex h-7 items-center rounded-lg border px-3 text-xs font-semibold tabular-nums transition-colors ${
    on
      ? "border-transparent bg-primary text-primary-foreground"
      : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
  }`
}

function ScorePill({
  def,
  searchParams,
  selected,
  onSelect,
}: {
  def: ScoreDef
  searchParams: Pick<URLSearchParams, "get">
  selected: boolean
  onSelect: () => void
}) {
  const info = scoreValueInfo(def, searchParams)
  const tint = info.maxOnly
    ? "border-amber-400/45 bg-amber-400/[0.08]"
    : info.active
      ? "border-primary/45 bg-primary/[0.08]"
      : "border-border/65 bg-background/45 hover:border-border"
  const ring = selected ? "ring-1 ring-primary/60 !border-primary/70 bg-primary/[0.12]" : ""
  const valCls = info.maxOnly
    ? "bg-amber-400/15 text-amber-500 dark:text-amber-300"
    : info.active
      ? "bg-primary/15 text-primary"
      : "text-muted-foreground"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${tint} ${ring} ${def.fullWidth ? "col-span-full" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-base leading-none">{def.emoji}</span>
        <span className="truncate text-sm font-medium">{def.label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${valCls}`}>{info.label}</span>
        {selected && <ChevronDown className="h-3.5 w-3.5 text-primary" />}
      </span>
    </button>
  )
}

function ScoreThresholdEditor({
  def,
  searchParams,
  updateParams,
}: {
  def: ScoreDef
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
}) {
  const info = scoreValueInfo(def, searchParams)
  const [dragValue, setDragValue] = useState<[number, number] | null>(null)
  const committed: [number, number] = [info.vMin ?? def.min, info.vMax ?? def.max]
  const display = dragValue ?? committed
  // O slider trabalha no domínio de EXIBIÇÃO (σ quando a lente está ligada), mas
  // o que vai pra URL é sempre ponto — ver a nota em ScoreDef.unit.
  const write = (v: number | null, bound: "min" | "max") => {
    if (v == null) return null
    const p = toPoints(def, v, bound)
    if (p == null) return null
    // Limiar nas pontas da escala não é filtro: "≤ 10" e "≥ 0" não excluem nada.
    // Em Pontos o `lo > def.min` / `hi < def.max` já resolve, mas na lente o
    // domínio em σ tem pontas fracionárias e o thumb pode parar um passo aquém —
    // gravando um chip que promete recorte e não recorta.
    if (bound === "max" && p >= 10) return null
    if (bound === "min" && p <= 0) return null
    return String(p)
  }
  const commit = (next: number[]) => {
    const [lo, hi] = next as [number, number]
    updateParams({
      [def.minKey]: lo > def.min ? write(lo, "min") : null,
      [def.maxKey]: hi < def.max ? write(hi, "max") : null,
    })
    setDragValue(null)
  }
  const setMinPreset = (p: number | null) => {
    setDragValue(null)
    updateParams({ [def.minKey]: p != null ? write(p, "min") : null, [def.maxKey]: null })
  }
  // Em σ o preset não bate exato: ele é gravado em pontos e encaixado na grade
  // de 0,5, então "+0,5σ" volta como +0,49σ. Comparar por igualdade deixaria o
  // chip que o usuário acabou de clicar apagado.
  // Em σ o preset volta deslocado: ele é gravado em pontos e encaixado na grade
  // de 0,5, então "+0,5σ" pode voltar como +0,33σ. A tolerância é meia casa da
  // GRADE convertida pro σ daquele atributo — usar um número fixo deixava o chip
  // recém-clicado apagado nos atributos de σ estreito (protagonista, σ 0,89).
  const presetActive = (p: number) => {
    if (info.hasMax || info.vMin == null) return false
    if (def.unit !== "sd") return info.vMin === p
    const sd = def.moment?.sd
    if (!sd) return false
    return Math.abs(info.vMin - p) < SCORE_GRID / (2 * sd)
  }
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setMinPreset(null)} className={editorChip(!info.active)}>
          Qualquer
        </button>
        {def.presets.map((p) => (
          <button key={p} type="button" onClick={() => setMinPreset(p)} className={editorChip(presetActive(p))}>
            ≥ {fmtScore(def, p)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Faixa</span>
        <Slider
          value={display}
          min={def.min}
          max={def.max}
          step={def.step}
          minStepsBetweenThumbs={1}
          onValueChange={(v) => setDragValue([v[0], v[1]] as [number, number])}
          onValueCommit={commit}
          className="flex-1"
        />
        <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-primary">
          {fmtScore(def, display[0])} – {fmtScore(def, display[1])}
        </span>
      </div>
      {/* Em σ o número não diz nada sozinho: "+1σ" é 6,7 em humor e 8,6 em
          romance. Sem esta linha o controle vira um filtro cego — que foi
          exatamente o defeito da Assinatura que este modo substitui. */}
      {def.unit === "sd" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {def.moment && def.moment.sd > 0 ? (
            <>
              Hoje, em {def.label.toLowerCase()}: {fmtScore(def, display[0])} ={" "}
              <span className="font-semibold tabular-nums text-foreground">
                {(sigmaToScore(display[0], def.moment) ?? 0).toFixed(1)}
              </span>{" "}
              pts e {fmtScore(def, display[1])} ={" "}
              <span className="font-semibold tabular-nums text-foreground">
                {(sigmaToScore(display[1], def.moment) ?? 0).toFixed(1)}
              </span>{" "}
              pts (média {def.moment.mean.toFixed(1)}, σ {def.moment.sd.toFixed(2)}).
            </>
          ) : (
            "Sem média do catálogo para este atributo — o limiar em σ não se aplica."
          )}
        </p>
      )}
    </>
  )
}


function VotesThresholdEditor({
  searchParams,
  updateParams,
  confidenceVotes,
}: {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  confidenceVotes?: number | null
}) {
  const currentMin = num(searchParams.get("min_votes"))
  const hasMax = searchParams.get("max_votes") != null
  const presetActive = (p: number | null) =>
    !hasMax && (p == null ? currentMin === undefined : currentMin === p)
  // Limiar de confiança do público (pseudo-votos): acima dele a média externa pesa
  // ≥50%. Marca o preset mais perto e oferece um clique pra usar o valor exato.
  const C = confidenceVotes != null && confidenceVotes > 0 ? Math.round(confidenceVotes) : null
  const nearestMin =
    C == null
      ? null
      : VOTES_PRESETS.reduce<number | null>((best, p) => {
          if (p.min == null) return best
          return best == null || Math.abs(p.min - C) < Math.abs(best - C) ? p.min : best
        }, null)
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {VOTES_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() =>
              updateParams({ min_votes: preset.min != null ? String(preset.min) : null, max_votes: null })
            }
            title={preset.min === nearestMin ? "≈ limiar de confiança do público" : undefined}
            className={cn(
              editorChip(presetActive(preset.min)),
              preset.min === nearestMin && "ring-1 ring-emerald-500/50",
            )}
          >
            {preset.label}
            {preset.min === nearestMin && <span className="ml-1 text-emerald-500">✓</span>}
          </button>
        ))}
      </div>
      {C != null && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            <span className="text-emerald-600 dark:text-emerald-400">Confiável</span> ≈{" "}
            <span className="font-mono font-semibold text-foreground">{C.toLocaleString("pt-BR")}</span>{" "}
            votos — acima disso a média externa pesa ≥ 50% na Nota Prevista.
          </span>
          <button
            type="button"
            onClick={() => updateParams({ min_votes: String(C), max_votes: null })}
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            usar
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Manual
        </Label>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Mín"
          size="sm"
          className="h-8 w-24 text-xs"
          value={searchParams.get("min_votes") ?? ""}
          onChange={(e) => updateParams({ min_votes: e.target.value || null })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Máx"
          size="sm"
          className="h-8 w-24 text-xs"
          value={searchParams.get("max_votes") ?? ""}
          onChange={(e) => updateParams({ max_votes: e.target.value || null })}
        />
      </div>
    </>
  )
}

function ScorePillGroup({
  title,
  defs,
  cols,
  searchParams,
  updateParams,
  confidenceVotes,
  headerAction,
}: {
  title: string
  defs: ScoreDef[]
  cols: 2 | 3
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  confidenceVotes?: number | null
  headerAction?: React.ReactNode
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selectedDef = defs.find((d) => d.key === selectedKey) ?? null
  const gridCls = cols === 3 ? "grid grid-cols-2 gap-2 lg:grid-cols-3" : "grid grid-cols-2 gap-2"
  return (
    <FilterSection title={title} headerAction={headerAction}>
      <div className={gridCls}>
        {defs.map((def) => (
          <ScorePill
            key={def.key}
            def={def}
            searchParams={searchParams}
            selected={selectedKey === def.key}
            onSelect={() => setSelectedKey((cur) => (cur === def.key ? null : def.key))}
          />
        ))}
      </div>
      {selectedDef && (
        <div className="mt-2.5 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/[0.05] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="text-base leading-none">{selectedDef.emoji}</span>
              {selectedDef.label}
              {selectedDef.help && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`O que é ${selectedDef.label}`}
                        className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs leading-relaxed">
                      {selectedDef.help}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </span>
            <button
              type="button"
              onClick={() => updateParams({ [selectedDef.minKey]: null, [selectedDef.maxKey]: null })}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              limpar <X className="h-3 w-3" />
            </button>
          </div>
          {selectedDef.kind === "votes" ? (
            <VotesThresholdEditor searchParams={searchParams} updateParams={updateParams} confidenceVotes={confidenceVotes} />
          ) : (
            <ScoreThresholdEditor def={selectedDef} searchParams={searchParams} updateParams={updateParams} />
          )}
        </div>
      )}
    </FilterSection>
  )
}

function csvValueToSet(value: string | null | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean))
}

function encodeCsvSet(set: Set<string>): string | null {
  return set.size === 0 ? null : [...set].join(",")
}

/**
 * Símbolo que não desenha nada além do próprio rótulo é ruído — e num card apertado
 * ainda rouba largura de quem tem o que dizer. Dois casos, os dois vindos do banco
 * (`publication_status.symbol` / `personal_status.symbol`):
 *
 * - `？` em "Unknown" — o rótulo repetido em glifo;
 * - `⎯` (U+23AF) em "Untracked" — um traço, que não é ícone de coisa nenhuma.
 *
 * Filtra pelo GLIFO, não pelo nome do status: renomear a linha no banco não devolve o
 * ícone, e um status novo que use um desses cai na mesma regra sem ninguém lembrar
 * dela. Os traços vizinhos entram junto porque a diferença entre `-`, `–` e `⎯` não é
 * visível na tela — trocar um pelo outro no banco não pode ressuscitar o ruído.
 */
const UNINFORMATIVE_SYMBOLS = new Set(["?", "？", "-", "–", "—", "―", "−", "⎯"])

/**
 * Chip de status com TRÊS estados: neutro · incluído · excluído.
 *
 * A anatomia é a mesma das abas Gêneros e Tags (`[−] rótulo`) de propósito — o gesto de
 * excluir já foi aprendido lá, e inventar outro aqui criaria duas gramáticas para a
 * mesma ideia. A diferença é o que marca o estado EXCLUÍDO:
 *
 * 🔴 **Excluído é FORMA, não cor.** Cada status tem cor própria vinda do banco
 * (`Cancelled` já é vermelho `#EF4444`, `Completed` é verde). Pintar o excluído de
 * vermelho colidiria com a identidade do status — e "Cancelled excluído" ficaria
 * vermelho sobre vermelho, indistinguível do neutro. Por isso: risco + borda tracejada
 * + opacidade, que funcionam sobre qualquer cor. Mesma régua do 2º nível das tags
 * amadas (ver CLAUDE.md, "Tag amada tem DOIS níveis").
 */
function StatusButton({
  option,
  active,
  excluded,
  onClick,
  onExclude,
  tooltip,
}: {
  option: StatusOption
  active: boolean
  /** Na lista de exclusão da dimensão. Nunca é `true` junto com `active`. */
  excluded?: boolean
  onClick: () => void
  /** Ausente = a dimensão não oferece exclusão (a zona `−` não é desenhada). */
  onExclude?: () => void
  tooltip?: string | null
}) {
  const style = active && option.color
    ? { backgroundColor: option.color, borderColor: option.color, color: "#fff" }
    : option.color
      ? { borderColor: option.color, color: option.color }
      : undefined
  const symbol =
    option.symbol && !UNINFORMATIVE_SYMBOLS.has(option.symbol.trim()) ? option.symbol : null
  const label = (
    <>
      {symbol && <span className="text-xs">{symbol}</span>}
      <span className={excluded ? "line-through decoration-[1.5px]" : undefined}>{option.status}</span>
    </>
  )

  const chip = onExclude ? (
    <div
      className={cn(
        "inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-full border transition-transform hover:-translate-y-px",
        excluded ? "border-dashed opacity-60" : "",
        active ? "" : "bg-transparent",
      )}
      style={
        option.color
          ? { borderColor: option.color, ...(active ? { backgroundColor: option.color } : {}) }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onExclude}
        aria-pressed={excluded}
        aria-label={excluded ? `Parar de excluir ${option.status}` : `Excluir ${option.status}`}
        title={excluded ? `Parar de excluir ${option.status}` : `Excluir ${option.status}`}
        className={cn(
          // px-1.5 (e não px-2): a zona "−" custa ~22px por pill, e o card de Status
          // pessoal tem 10 deles — cada 2px aqui vale 20px de linha. Ver a nota de
          // largura em `--l1cols2xl`.
          "flex items-center border-r px-1.5 text-sm font-bold leading-none transition-colors",
          active ? "border-white/35 text-white" : "border-border/60 text-muted-foreground",
          "hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Minus className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-2 text-[13px] font-medium"
        style={active ? { color: "#fff" } : option.color ? { color: option.color } : undefined}
      >
        {label}
      </button>
    </div>
  ) : (
    <button onClick={onClick} type="button" className="shrink-0">
      <Badge
        variant={active ? "default" : "outline"}
        className="inline-flex h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2 text-[13px] font-medium transition-transform hover:-translate-y-px"
        style={style}
      >
        {label}
      </Badge>
    </button>
  )

  if (!tooltip?.trim()) return chip

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Interruptor do MODO de exclusão de um card de status.
 *
 * A zona `−` deixou de ser desenhada por padrão: ela custa ~22px por pill (ver a nota
 * de largura em `--l1cols2xl`) e cobra esse preço em toda visita, enquanto excluir é
 * uso ocasional. Aqui ele é ligado sob demanda, um por card — cada card já tem o seu
 * "Todos" e o seu contador "(exceto N)", então o controle mora ao lado do que muda.
 *
 * 🔴 **Desligar LIMPA as exclusões, e isso não é conveniência.** Se o modo pudesse ser
 * desligado com `pub_status_exclude` de pé, existiria filtro ativo sem nenhum controle
 * na tela que o explique — o mesmo filtro fantasma que o badge "Todos" já é obrigado a
 * evitar (ele zera os DOIS params de propósito). Pela mesma razão o modo é DERIVADO:
 * `ligado = escolha manual OU já há exclusão`, então preset salvo, link colado e o
 * voltar do browser acendem o controle sozinhos, em vez de esconder o que aplicaram.
 */
function ExcludeModeToggle({
  on,
  onToggle,
  dimension,
  activeCount,
}: {
  on: boolean
  onToggle: () => void
  /** "de publicação" / "pessoal" — entra no rótulo acessível. */
  dimension: string
  activeCount: number
}) {
  // ⚠️ A dimensão entra nos DOIS estados: os dois cards desenham este botão lado a
  // lado, e rótulo acessível idêntico deixa quem navega por leitor de tela (e o
  // `getByRole` do teste) sem saber qual é qual.
  const title = on
    ? activeCount
      ? `Sair do modo excluir status ${dimension} (remove ${activeCount === 1 ? "a exclusão" : `as ${activeCount} exclusões`})`
      : `Sair do modo excluir status ${dimension}`
    : `Excluir status ${dimension} em vez de selecionar`
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors",
        on
          ? "border-primary/45 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <Minus className="h-3 w-3" />
      Excluir
    </button>
  )
}

function FacetLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/55 bg-background/45 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground/80">Seleção</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300">
        <Plus className="h-3 w-3" /> obrigatório (AND)
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-300">
        <span className="inline-flex items-center gap-0.5">
          <Plus className="h-3 w-3" />
          <Plus className="h-3 w-3" />
        </span>{" "}
        opcional (OR)
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/10 px-2 py-0.5 text-rose-300">
        <Minus className="h-3 w-3" /> excluir (NOT)
      </span>
    </div>
  )
}

function dedupeStatusOptions(options: StatusOption[]): StatusOption[] {
  const byStatus = new Map<string, StatusOption>()

  for (const option of options) {
    const current = byStatus.get(option.status)
    if (!current) {
      byStatus.set(option.status, option)
      continue
    }

    const currentHasDisplay = Boolean(current.color || current.symbol)
    const nextHasDisplay = Boolean(option.color || option.symbol)
    if (!currentHasDisplay && nextHasDisplay) {
      byStatus.set(option.status, option)
    }
  }

  return [...byStatus.values()]
}

interface FacetedChoice {
  value: string
  label: string
}

interface GroupedFacetedChoice extends FacetedChoice {
  groupName: string
  subGroupName?: string
}

type FacetRule = "all" | "any" | "exclude" | null

interface GenreRuleGridProps {
  items: string[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onSetRule: (value: string, rule: FacetRule) => void
  /** Mostra a legenda AND/OR/EXCLUDE acima do grid. False quando a legenda já é
   *  exibida uma vez acima de vários grids (split Gêneros/Demografia). */
  showLegend?: boolean
}

/** Um segmento do controle "Esconder evitadas" (rascunho; estado ativo em rosa). */
function HideAvoidedSegment({
  onSelect,
  active,
  label,
  tooltip,
}: {
  onSelect: () => void
  active: boolean
  label: string
  tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          className={`inline-flex h-7 items-center whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
            active
              ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="w-[220px] text-pretty">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Segmentado "Conteúdo 18+" — filtra pela classificação da obra (works.is_adult),
 * NÃO por tags. Espelha o padrão visual do "Esconder tags evitadas" vizinho, mas
 * usa updateParams (draft) como os demais controles de ?adult=. "Tudo" respeita a
 * preferência global do usuário; "Ocultar"/"Só 18+" mandam neste ranking.
 */
function AdultContentSegment({
  value,
  onChange,
}: {
  value: "all" | "hide" | "only"
  onChange: (v: "all" | "hide" | "only") => void
}) {
  const seg = (active: boolean, danger: boolean) =>
    `inline-flex h-7 items-center gap-1 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
      active
        ? danger
          ? "bg-red-500/15 text-red-600 dark:text-red-300"
          : "bg-primary/15 text-primary"
        : "text-muted-foreground hover:text-foreground"
    }`
  return (
    <div className="inline-flex rounded-md border border-border/70 bg-background/60 p-0.5">
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-pressed={value === "all"}
        className={seg(value === "all", false)}
        title="Mostra todas as obras (respeita sua preferência global de 18+ em /preferencias)."
      >
        Tudo
      </button>
      <button
        type="button"
        onClick={() => onChange("hide")}
        aria-pressed={value === "hide"}
        className={seg(value === "hide", true)}
        title="Esconde as obras classificadas como 18+ neste ranking."
      >
        Ocultar <span aria-hidden>🔞</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("only")}
        aria-pressed={value === "only"}
        className={seg(value === "only", true)}
        title="Mostra apenas as obras classificadas como 18+."
      >
        Só 18+ <span aria-hidden>🔞</span>
      </button>
    </div>
  )
}

/** Rótulo de sub-grupo dentro da aba Gêneros (Demografia / Gêneros). */
function GenreGroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
        {count}
      </span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function GenreRuleGrid({
  items,
  selectedAll,
  selectedAny,
  selectedExclude,
  onSetRule,
  showLegend = true,
}: GenreRuleGridProps) {
  const [expanded, setExpanded] = useState(false)
  const selectedCount = selectedAll.size + selectedAny.size + selectedExclude.size
  const visibleLimit = 36

  const getRule = (value: string): FacetRule => {
    if (selectedAll.has(value)) return "all"
    if (selectedAny.has(value)) return "any"
    if (selectedExclude.has(value)) return "exclude"
    return null
  }

  const orderedItems = useMemo(() => {
    const weight = (value: string) => {
      const rule = getRule(value)
      if (rule === "all") return 0
      if (rule === "any") return 1
      if (rule === "exclude") return 2
      return 3
    }
    return [...items].sort((a, b) => {
      const diff = weight(a) - weight(b)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
    // getRule depends on the selected sets above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedAll, selectedAny, selectedExclude])

  const visibleItems = expanded
    ? orderedItems
    : orderedItems.slice(0, Math.max(visibleLimit, selectedCount))

  const stateClass: Record<Exclude<FacetRule, null> | "none", string> = {
    none: "border-border/70 bg-background/45 text-foreground",
    all: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-100",
    any: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-100",
    exclude: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/25 dark:bg-rose-400/12 dark:text-rose-100",
  }

  const stateLabel: Record<Exclude<FacetRule, null>, string> = {
    all: "AND",
    any: "OR",
    exclude: "EXCLUDE",
  }

  return (
    <div className="space-y-3">
      {showLegend && <FacetLegend />}

      <div className="rounded-lg border border-border/65 bg-background/45 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleItems.map((item) => {
            const rule = getRule(item)
            const addTitle =
              rule === "all"
                ? `Mudar ${item} para OR`
                : rule === "any"
                  ? `Remover ${item} dos filtros`
                  : `Adicionar ${item} como AND`
            const removeTitle = rule === "exclude"
              ? `Remover ${item} dos excluídos`
              : `Excluir ${item}`

            return (
              <div
                key={item}
                className={`grid h-10 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border text-sm transition-colors ${stateClass[rule ?? "none"]}`}
              >
                <button
                  type="button"
                  onClick={() => onSetRule(item, rule === "exclude" ? null : "exclude")}
                  aria-label={removeTitle}
                  title={removeTitle}
                  className={`flex h-full items-center justify-center border-r transition-colors hover:bg-rose-100 ${
                    rule === "exclude" ? "bg-rose-100 text-rose-700" : "text-muted-foreground"
                  }`}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (rule) onSetRule(item, null)
                  }}
                  disabled={!rule}
                  aria-label={rule ? `Desmarcar ${item}` : `${item} não selecionado`}
                  title={rule ? `Desmarcar ${item}` : undefined}
                  className="flex h-full min-w-0 items-center justify-between gap-2 px-2 text-left disabled:cursor-default"
                >
                  <span className="truncate font-medium">{item}</span>
                  {rule && (
                    <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold">
                      {stateLabel[rule]}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSetRule(item, rule === "all" ? "any" : rule === "any" ? null : "all")}
                  aria-label={addTitle}
                  title={addTitle}
                  className={`flex h-full items-center justify-center border-l transition-colors ${
                    rule === "all"
                      ? "bg-emerald-100 text-emerald-700 hover:bg-sky-100 hover:text-sky-700"
                      : rule === "any"
                        ? "bg-sky-100 text-sky-700 hover:bg-muted"
                        : "text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        {items.length === 0 && (
          <span className="text-xs text-muted-foreground">Sem resultados</span>
        )}
        {orderedItems.length > visibleLimit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 h-8 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "Mostrar menos" : `Mostrar mais (${orderedItems.length - visibleLimit})`}
          </Button>
        )}
      </div>
    </div>
  )
}

interface GroupedTagRuleGridProps {
  items: GroupedFacetedChoice[]
  allItems?: GroupedFacetedChoice[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onSetRule: (value: string, rule: FacetRule) => void
  searchActive?: boolean
}

const TAG_STATE_CLASS: Record<Exclude<FacetRule, null> | "none", string> = {
  none: "border-border/70 bg-background/45 text-foreground",
  all: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-100",
  any: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-100",
  exclude: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/25 dark:bg-rose-400/12 dark:text-rose-100",
}

const TAG_STATE_LABEL: Record<Exclude<FacetRule, null>, string> = {
  all: "AND",
  any: "OR",
  exclude: "EXCLUDE",
}

const TAG_CHIP_CLASS: Record<Exclude<FacetRule, null>, string> = {
  all: "border-emerald-400/60 bg-emerald-400/15 text-emerald-100",
  any: "border-sky-400/60 bg-sky-400/15 text-sky-100",
  exclude: "border-rose-400/60 bg-rose-400/15 text-rose-100",
}

const TAG_GRID_CLASS = "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"

interface ActiveGroupBodyProps {
  items: GroupedFacetedChoice[]
  getRule: (value: string) => FacetRule
  renderItem: (item: GroupedFacetedChoice, withGroupHint?: boolean) => ReactNode
}

// Renders the active group's tags. If the group has sub-groups (an applied
// `tag_subgroup`), they become collapsible sections; otherwise the flat grid
// is kept unchanged (graceful degradation for groups not yet organized).
function ActiveGroupBody({ items, getRule, renderItem }: ActiveGroupBodyProps) {
  const hasSubgroups = items.some((it) => it.subGroupName)

  const sections = useMemo(() => {
    const sortItems = (arr: GroupedFacetedChoice[]) =>
      [...arr].sort((a, b) => {
        const weight = (r: FacetRule) => (r === "all" ? 0 : r === "any" ? 1 : r === "exclude" ? 2 : 3)
        const diff = weight(getRule(a.value)) - weight(getRule(b.value))
        return diff !== 0 ? diff : a.label.localeCompare(b.label)
      })
    const bySub = new Map<string, GroupedFacetedChoice[]>()
    const ungrouped: GroupedFacetedChoice[] = []
    for (const it of items) {
      if (it.subGroupName) {
        const arr = bySub.get(it.subGroupName) ?? []
        arr.push(it)
        bySub.set(it.subGroupName, arr)
      } else {
        ungrouped.push(it)
      }
    }
    const subs = [...bySub.entries()]
      .map(([name, its]) => ({ name, items: sortItems(its) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (ungrouped.length > 0) subs.push({ name: "Outras", items: sortItems(ungrouped) })
    return subs
    // getRule depends on the parent's selection sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Default: collapsed, except sections that already have active selections.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>()
    for (const s of sections) {
      if (s.items.some((it) => Boolean(getRule(it.value)))) open.add(s.name)
    }
    return open
  })
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  if (!hasSubgroups) {
    return <div className={TAG_GRID_CLASS}>{items.map((item) => renderItem(item))}</div>
  }

  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const selectedCount = section.items.filter((it) => Boolean(getRule(it.value))).length
        const open = expanded.has(section.name)
        return (
          <div key={section.name} className="overflow-hidden rounded-lg border border-border/55 bg-background/30">
            <button
              type="button"
              onClick={() => toggle(section.name)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background/50"
            >
              {open ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">{section.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{section.items.length}</span>
              {selectedCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400/25 px-1.5 text-[11px] font-bold tabular-nums text-emerald-100">
                  {selectedCount}
                </span>
              )}
            </button>
            {open && (
              <div className="px-3 pb-3">
                <div className={TAG_GRID_CLASS}>{section.items.map((item) => renderItem(item))}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function GroupedTagRuleGrid({
  items,
  allItems,
  selectedAll,
  selectedAny,
  selectedExclude,
  onSetRule,
  searchActive = false,
}: GroupedTagRuleGridProps) {
  const getRule = (value: string): FacetRule => {
    if (selectedAll.has(value)) return "all"
    if (selectedAny.has(value)) return "any"
    if (selectedExclude.has(value)) return "exclude"
    return null
  }

  const groups = useMemo(() => {
    const byGroup = new Map<string, GroupedFacetedChoice[]>()
    for (const item of items) {
      const groupName = item.groupName || "Sem grupo"
      const groupItems = byGroup.get(groupName) ?? []
      groupItems.push(item)
      byGroup.set(groupName, groupItems)
    }
    return [...byGroup.entries()]
      .map(([groupName, groupItems]) => ({
        groupName,
        // Fixed alphabetical order so selecting a tag doesn't move it.
        items: groupItems.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName))
  }, [items])

  // Lookup: slug -> { label, groupName } for the selection strip.
  // Uses the unfiltered list so selected chips keep their labels under active search.
  const itemBySlug = useMemo(() => {
    const map = new Map<string, GroupedFacetedChoice>()
    const source = allItems ?? items
    for (const item of source) map.set(item.value, item)
    return map
  }, [allItems, items])

  const selectedEntries = useMemo(() => {
    const rows: Array<{ slug: string; label: string; groupName: string; rule: Exclude<FacetRule, null> }> = []
    const push = (slug: string, rule: Exclude<FacetRule, null>) => {
      const item = itemBySlug.get(slug)
      rows.push({
        slug,
        label: item?.label ?? slug,
        groupName: item?.groupName ?? "—",
        rule,
      })
    }
    selectedAll.forEach((s) => push(s, "all"))
    selectedAny.forEach((s) => push(s, "any"))
    selectedExclude.forEach((s) => push(s, "exclude"))
    const ruleOrder = { all: 0, any: 1, exclude: 2 } as const
    rows.sort((a, b) => {
      const diff = ruleOrder[a.rule] - ruleOrder[b.rule]
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    })
    return rows
  }, [selectedAll, selectedAny, selectedExclude, itemBySlug])

  // Active group state. Initially: group with most selections, else first alphabetical.
  const computeDefaultGroup = () => {
    if (groups.length === 0) return null
    let best = groups[0].groupName
    let bestCount = -1
    for (const g of groups) {
      const count = g.items.filter((it) => Boolean(getRule(it.value))).length
      if (count > bestCount) {
        bestCount = count
        best = g.groupName
      }
    }
    return best
  }
  const [activeGroup, setActiveGroup] = useState<string | null>(computeDefaultGroup)

  // If the active group disappears (e.g., dataset changed), fall back to first.
  const activeGroupExists = activeGroup !== null && groups.some((g) => g.groupName === activeGroup)
  const effectiveActiveGroup = activeGroupExists ? activeGroup : groups[0]?.groupName ?? null

  const cycleRule = (rule: FacetRule): FacetRule =>
    rule === "all" ? "any" : rule === "any" ? "exclude" : rule === "exclude" ? null : "all"

  const renderItem = (item: GroupedFacetedChoice, withGroupHint = false) => {
    const rule = getRule(item.value)
    const addTitle =
      rule === "all"
        ? `Mudar ${item.label} para OR`
        : rule === "any"
          ? `Remover ${item.label} dos filtros`
          : `Adicionar ${item.label} como AND`
    const removeTitle = rule === "exclude"
      ? `Remover ${item.label} dos excluídos`
      : `Excluir ${item.label}`

    return (
      <div
        key={item.value}
        title={item.label}
        className={`grid h-10 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border text-sm transition-colors ${TAG_STATE_CLASS[rule ?? "none"]}`}
      >
        <button
          type="button"
          onClick={() => onSetRule(item.value, rule === "exclude" ? null : "exclude")}
          aria-label={removeTitle}
          title={removeTitle}
          className={`flex h-full items-center justify-center border-r transition-colors hover:bg-rose-100 ${
            rule === "exclude" ? "bg-rose-100 text-rose-700" : "text-muted-foreground"
          }`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (rule) onSetRule(item.value, null)
          }}
          disabled={!rule}
          aria-label={rule ? `Desmarcar ${item.label}` : `${item.label} não selecionado`}
          title={rule ? `${item.label} — clique para desmarcar` : item.label}
          className="flex h-full min-w-0 items-center justify-between gap-2 px-2 text-left disabled:cursor-default"
        >
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{item.label}</span>
            {withGroupHint && (
              <span className="truncate text-[11px] font-normal text-muted-foreground">{item.groupName}</span>
            )}
          </span>
          {rule && (
            <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold">
              {TAG_STATE_LABEL[rule]}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSetRule(item.value, rule === "all" ? "any" : rule === "any" ? null : "all")}
          aria-label={addTitle}
          title={addTitle}
          className={`flex h-full items-center justify-center border-l transition-colors ${
            rule === "all"
              ? "bg-emerald-100 text-emerald-700 hover:bg-sky-100 hover:text-sky-700"
              : rule === "any"
                ? "bg-sky-100 text-sky-700 hover:bg-muted"
                : "text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const activeGroupData = effectiveActiveGroup
    ? groups.find((g) => g.groupName === effectiveActiveGroup)
    : null

  return (
    <div className="space-y-3">
      <FacetLegend />

      {selectedEntries.length > 0 && (
        <div className="rounded-lg border border-border/65 bg-background/45 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Selecionadas</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
              {selectedEntries.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedEntries.map((entry) => (
              <span
                key={`${entry.rule}-${entry.slug}`}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${TAG_CHIP_CLASS[entry.rule]}`}
              >
                <button
                  type="button"
                  onClick={() => onSetRule(entry.slug, cycleRule(entry.rule))}
                  title={`${entry.label} — clique para alternar (atual: ${TAG_STATE_LABEL[entry.rule]})`}
                  className="flex items-center gap-1.5"
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[9px] font-bold">
                    {TAG_STATE_LABEL[entry.rule]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetRule(entry.slug, null)}
                  aria-label={`Remover ${entry.label}`}
                  title={`Remover ${entry.label}`}
                  className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-background/30"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {searchActive ? (
        items.length === 0 ? (
          <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            Sem resultados
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {[...items]
              .sort((a, b) => a.label.localeCompare(b.label))
              .slice(0, 200)
              .map((item) => renderItem(item, true))}
            {items.length > 200 && (
              <div className="col-span-full rounded-lg border border-dashed border-border/60 p-2 text-center text-[11px] text-muted-foreground">
                Mostrando 200 de {items.length} resultados — refine a busca para ver mais.
              </div>
            )}
          </div>
        )
      ) : (
        <>
          {groups.length === 0 ? (
            <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
              Sem resultados
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {groups.map((group) => {
                  const selectedCount = group.items.filter((it) => Boolean(getRule(it.value))).length
                  const isActive = group.groupName === effectiveActiveGroup
                  return (
                    <button
                      key={group.groupName}
                      type="button"
                      onClick={() => setActiveGroup(group.groupName)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-border/65 bg-background/45 text-foreground hover:border-border hover:bg-background/70"
                      }`}
                    >
                      <span className="whitespace-nowrap">{group.groupName}</span>
                      <span className={`text-xs tabular-nums ${isActive ? "text-primary/80" : "text-muted-foreground"}`}>
                        {group.items.length}
                      </span>
                      {selectedCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400/25 px-1.5 text-xs font-bold tabular-nums text-emerald-100">
                          {selectedCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {activeGroupData && (
                <div className="rounded-lg border border-border/65 bg-background/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">{activeGroupData.groupName}</span>
                    <span className="text-muted-foreground tabular-nums">{activeGroupData.items.length} tags</span>
                  </div>
                  <ActiveGroupBody
                    key={activeGroupData.groupName}
                    items={activeGroupData.items}
                    getRule={getRule}
                    renderItem={renderItem}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Canoniza uma query string pra comparar dois conjuntos de filtros por igualdade
 * independentemente da ORDEM dos parâmetros — o draft monta na ordem de edição e a
 * URL na ordem que o Next serializa, então uma comparação byte-a-byte falharia à toa.
 * Ordena os pares `key=value` e junta.
 */
function canonicalizeQuery(query: string): string {
  const entries = [...new URLSearchParams(query).entries()].sort(
    ([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv),
  )
  return entries.map(([k, v]) => `${k}=${v}`).join("&")
}

function SavedFiltersControl({
  presets,
  basePath,
  currentQuery,
  onApply,
  onChange,
}: {
  presets: SavedFilterPreset[]
  basePath: string
  currentQuery: string
  onApply: (query: string) => void
  onChange: (next: SavedFilterPreset[]) => void
}) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [name, setName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [pending, startSaving] = useTransition()

  const startRename = (preset: SavedFilterPreset) => {
    setEditingId(preset.id)
    setEditingName(preset.name)
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName("")
  }

  const commitRename = (preset: SavedFilterPreset) => {
    const trimmed = editingName.trim()
    if (!trimmed || trimmed === preset.name) {
      cancelRename()
      return
    }
    startSaving(async () => {
      const res = await renameFilterPreset({ id: preset.id, basePath, name: trimmed })
      if (res.error !== null) {
        toast.error(res.error)
        return
      }
      onChange(presets.map((p) => (p.id === preset.id ? { ...p, name: res.preset.name } : p)))
      cancelRename()
      toast.success(`Renomeado para "${res.preset.name}"`)
    })
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    startSaving(async () => {
      const res = await saveFilterPreset({ basePath, name: trimmed, query: currentQuery })
      if (res.error !== null) {
        toast.error(res.error)
        return
      }
      const without = presets.filter((p) => p.name.toLowerCase() !== res.preset.name.toLowerCase())
      onChange([res.preset, ...without])
      setName("")
      setSaveOpen(false)
      toast.success(`Filtro "${res.preset.name}" salvo`)
    })
  }

  const remove = (preset: SavedFilterPreset) => {
    startSaving(async () => {
      const res = await deleteFilterPreset({ id: preset.id, basePath })
      if (res.error) {
        toast.error(res.error)
        return
      }
      onChange(presets.filter((p) => p.id !== preset.id))
      toast.success(`Filtro "${preset.name}" removido`)
    })
  }

  return (
    <>
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="Salvar filtros atuais">
            <Save className="mr-1 h-3.5 w-3.5" />
            Salvar
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2 p-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nome do conjunto
          </Label>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Ex: Romance pendente"
              className="h-8 text-xs"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  save()
                }
              }}
            />
            <Button size="sm" className="h-8 shrink-0" onClick={save} disabled={pending || !name.trim()}>
              Salvar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Salva os filtros atuais (mesmo sem aplicar). Reusar um nome sobrescreve.
          </p>
        </PopoverContent>
      </Popover>

      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="Filtros salvos">
            <Bookmark className="mr-1 h-3.5 w-3.5" />
            Salvos{presets.length > 0 ? ` (${presets.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          {presets.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhum filtro salvo ainda.
            </p>
          ) : (
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {presets.map((preset) => (
                editingId === preset.id ? (
                  <div key={preset.id} className="flex items-center gap-1 rounded-md p-1">
                    <Input
                      autoFocus
                      className="h-7 text-sm"
                      value={editingName}
                      maxLength={60}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          commitRename(preset)
                        } else if (e.key === "Escape") {
                          e.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => commitRename(preset)}
                      disabled={pending || !editingName.trim()}
                      aria-label="Confirmar novo nome"
                      title="Confirmar"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      aria-label="Cancelar"
                      title="Cancelar"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    key={preset.id}
                    className="group flex items-center gap-1 rounded-md transition-colors hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onApply(preset.query)
                        setListOpen(false)
                      }}
                      title="Aplicar este conjunto de filtros"
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(preset)}
                      disabled={pending}
                      aria-label={`Renomear ${preset.name}`}
                      title={`Renomear ${preset.name}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(preset)}
                      disabled={pending}
                      aria-label={`Remover ${preset.name}`}
                      title={`Remover ${preset.name}`}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}

export function RankingFilters({
  availableGenres,
  genreCatTypes,
  showHideAvoided,
  availableTags,
  publicationStatuses = [],
  personalStatuses = [],
  defaultPublicationStatus,
  defaultPersonalStatus,
  defaultTopN,
  basePath = "/ranking",
  defaultSort,
  savedPresets = [],
  // 🔴 Nunca um literal aqui: este default é a MESMA afirmação que a constante medida
  // e que o DEFAULT da coluna. Ele ficou em `0.5` depois que os outros dois foram para
  // 0,25, e só não apareceu na tela porque o único consumidor que mostra a seção
  // (`/ranking`) passa a prop — `/favorites` desliga com `showTierBand={false}`. O
  // próximo consumidor que a mostrasse veria "0,5 (Padrão)" contra o 0,25 do /ranking.
  defaultBand = DEFAULT_TIER_BAND_WIDTH,
  criterionPresets,
  criterionMoments,
  criterionRanges,
  confidenceVotes,
  showTopN = true,
  showTierBand = true,
  showArtFilter = false,
  showAdultFilter = false,
}: RankingFiltersProps) {
  /**
   * As trilhas do grid da aba Geral foram calibradas para o /ranking, que traz
   * DOIS controles a mais: "Obras exibidas" (showTopN) e "Largura dos tiers"
   * (showTierBand). Onde eles não existem (favoritos) sobra largura, e as
   * mesmas trilhas deixavam ~470px de buraco medido: 45% do card de Critérios
   * gerais e ~1/3 dos de Interesse e Conteúdo exibido. `roomy` = a página não
   * tem os controles de tuning → trilhas mais estreitas onde o conteúdo é
   * pequeno, e mais respiro dentro dos cards que ficam largos.
   */
  const roomy = !showTopN && !showTierBand
  /**
   * Colunas da LINHA 1 (Publicação · Status pessoal · Critérios gerais). O mínimo em px
   * do 3º card é o que impede a trilha enxuta de esmagar Caps/Ano (194px de conteúdo +
   * 40 de padding) em telas médias: com minmax(0,…) o card estourava 11px em 1280.
   * A variante `ExcludeMode` é a compensação da zona "−" — ver a nota em `--l1cols2xl`.
   */
  const l1ColsBase = roomy
    ? "minmax(0,1.2fr) minmax(0,2.15fr) minmax(240px,0.75fr)"
    : "minmax(0,1.25fr) minmax(0,2.25fr) minmax(0,1.3fr)"
  const l1ColsExcludeMode = roomy
    ? "minmax(0,1.35fr) minmax(0,2fr) minmax(240px,0.75fr)"
    : "minmax(0,1.4fr) minmax(0,2.1fr) minmax(0,1.3fr)"
  const router = useRouter()
  const appliedSearchParams = useSearchParams()
  const appliedSearchString = appliedSearchParams.toString()
  const [draftSearch, setDraftSearch] = useState(appliedSearchString)

  // 🔴 O rascunho ADOTA a URL sempre que ela muda por fora do painel.
  //
  // Sem isto o rascunho só era semeado no 1º render, e todo navegador de URL que
  // NÃO passa por "Aplicar filtros" — clique no cabeçalho da tabela (`updateSort`),
  // chip de filtro ativo da view Faixas, voltar/avançar do browser — deixava o
  // rascunho preso numa foto velha. O próximo "Aplicar filtros" reescrevia a URL a
  // partir dessa foto e APAGAVA o que tinha sido feito por fora, sem erro nenhum:
  // o filtro (ou a ordenação) simplesmente voltava ao estado anterior, com cara de
  // "não aplicou".
  //
  // Ajuste DURANTE o render (não `useEffect`): o painel já re-renderiza com o valor
  // certo, sem um frame mostrando o rascunho velho. O "último aplicado" é ESTADO,
  // não ref — ler/escrever `ref.current` no render é proibido pelo lint do React
  // (e não agenda re-render). E ele é semeado com o valor INICIAL: começar em
  // `null` faria isto disparar na própria renderização de hidratação (ver
  // CLAUDE.md, "adjust-during-render").
  //
  // Preço aceito: edição pendente não aplicada é descartada quando a pessoa navega
  // por fora. A URL é a verdade do que está na tela; o rascunho é que é a cópia.
  const [lastApplied, setLastApplied] = useState(appliedSearchString)
  if (lastApplied !== appliedSearchString) {
    setLastApplied(appliedSearchString)
    setDraftSearch(appliedSearchString)
  }

  const searchParams = useMemo(() => new URLSearchParams(draftSearch), [draftSearch])
  // Sem momentos a lente não funciona: força Pontos em vez de deixar o seletor
  // dizer σ enquanto os pills mostram pontos.
  const criterionUnit = criterionMoments ? readCriterionUnit(searchParams) : "points"
  const criterionScoreDefs = useMemo(
    () =>
      buildCriterionScoreDefs(
        criterionPresets ?? DEFAULT_CRITERION_SCORE_PRESETS,
        criterionUnit,
        criterionMoments,
      ),
    [criterionPresets, criterionUnit, criterionMoments]
  )
  // isApplying: a navegação por filtro (router.replace) roda numa transition que
  // fica pendente enquanto o servidor re-renderiza o ranking (~1s). Sem expor isso,
  // o clique em "Aplicar filtros" ficava sem feedback nenhum nesse intervalo.
  const [isApplying, startTransition] = useTransition()
  const [collapsed, setCollapsed] = useCollapsedFilters(`ranking:${basePath}`)
  /** Um só alvo para os três gatilhos do cabeçalho: o ícone, o título e o ⌃. */
  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), [setCollapsed])
  const [presets, setPresets] = useState<SavedFilterPreset[]>(savedPresets)

  // Preset salvo que casa EXATAMENTE com os filtros aplicados (na URL) — alimenta o
  // chip "filtro salvo ativo" ao lado do título. Comparação canônica (ordem-insensível).
  // Ao mexer em qualquer filtro/ordenação depois de aplicar, deixa de casar e o chip
  // some (honesto: o que está na tela já não é mais o preset).
  const appliedPreset = useMemo(() => {
    const canon = canonicalizeQuery(appliedSearchString)
    if (!canon) return null
    return presets.find((p) => canonicalizeQuery(p.query) === canon) ?? null
  }, [appliedSearchString, presets])

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setDraftSearch((current) => {
        const params = new URLSearchParams(current)
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "") {
            params.delete(key)
          } else {
            params.set(key, value)
          }
        }
        return params.toString()
      })
    },
    []
  )

  const filtersDirty = draftSearch !== appliedSearchString
  const hasFilters = draftSearch !== "" || appliedSearchString !== ""

  // Esconder tags evitadas: lê do RASCUNHO como todo o resto do painel.
  const hideAvoidedRaw = searchParams.get("hide_avoided")
  const hideAvoidedMode: "off" | "strong" | "all" =
    hideAvoidedRaw === "strong" || hideAvoidedRaw === "all" ? hideAvoidedRaw : "off"

  // Estimativa de arte: lê do RASCUNHO como todo o resto do painel — navegar por fora dele
  // apagaria a escolha no Aplicar seguinte.
  const artMode = parseArtFilter(searchParams.get(ART_FILTER_PARAM)) ?? "off"

  // Top N (URL pode sobrescrever a preferência do DB). Alimenta o campo "Obras exibidas".
  const urlTopN = num(searchParams.get("top_n"))

  const applyAllFilters = () => {
    const target = draftSearch ? `${basePath}?${draftSearch}` : basePath
    startTransition(() => router.replace(target))
  }

  // "Limpar" é imediato: zera o rascunho E navega, sem exigir "Aplicar filtros".
  const clearAll = () => {
    setDraftSearch("")
    startTransition(() => router.replace(basePath))
  }

  const applyPreset = (query: string) => {
    setDraftSearch(query)
    const target = query ? `${basePath}?${query}` : basePath
    startTransition(() => router.replace(target))
  }

  // Multi-select helpers (CSV em URL)
  const csvSet = (key: string): Set<string> => {
    return csvValueToSet(searchParams.get(key))
  }
  const toggleCsv = (key: string, item: string) => {
    const set = csvSet(key)
    if (set.has(item)) set.delete(item)
    else set.add(item)
    updateParams({ [key]: set.size === 0 ? null : [...set].join(",") })
  }
  const selectedGenreAll = csvSet("genres_all")
  const selectedGenreAny = csvSet("genres_any")
  const selectedGenreExclude = csvSet("genres_exclude")

  const setGenreRule = (item: string, rule: FacetRule) => {
    const nextAll = new Set(selectedGenreAll)
    const nextAny = new Set(selectedGenreAny)
    const nextExclude = new Set(selectedGenreExclude)
    nextAll.delete(item)
    nextAny.delete(item)
    nextExclude.delete(item)

    if (rule === "all") nextAll.add(item)
    if (rule === "any") nextAny.add(item)
    if (rule === "exclude") nextExclude.add(item)

    updateParams({
      genres_all: encodeCsvSet(nextAll),
      genres_any: encodeCsvSet(nextAny),
      genres_exclude: encodeCsvSet(nextExclude),
    })
  }

  const selectedTagAll = csvSet("tags_all")
  const selectedTagAny = csvSet("tags_any")
  const selectedTagExclude = csvSet("tags_exclude")

  const setTagRule = (item: string, rule: FacetRule) => {
    const nextAll = new Set(selectedTagAll)
    const nextAny = new Set(selectedTagAny)
    const nextExclude = new Set(selectedTagExclude)
    nextAll.delete(item)
    nextAny.delete(item)
    nextExclude.delete(item)

    if (rule === "all") nextAll.add(item)
    if (rule === "any") nextAny.add(item)
    if (rule === "exclude") nextExclude.add(item)

    updateParams({
      tags_all: encodeCsvSet(nextAll),
      tags_any: encodeCsvSet(nextAny),
      tags_exclude: encodeCsvSet(nextExclude),
    })
  }

  const selectedSynopsisQ = csvSet("synopsis_q")
  const selectedSynopsisPred = csvSet("synopsis_pred")
  // MANUAL: o chip do travessão = obras sem ♥. Um token só desde a migration 179, que aposentou a
  // proveniência "Desconhecido" (o chip chegou a ligar dois tokens juntos).
  const manualOtherActive = selectedSynopsisQ.has(INTEREST_NONE)
  const toggleManualOther = () => toggleCsv("synopsis_q", INTEREST_NONE)
  // PREVISÃO: mesmo token, do outro lado — "sem previsão para o meu perfil".
  const predOtherActive = selectedSynopsisPred.has(INTEREST_NONE)
  const togglePredOther = () => toggleCsv("synopsis_pred", INTEREST_NONE)
  const interestMode: "and" | "or" = searchParams.get("synopsis_mode") === "and" ? "and" : "or"

  // Opções de status em duas listas: a COMPLETA (materializa o "todos") e a VISÍVEL
  // (o que vira chip). Só divergem no status pessoal, onde os terminais ficam fora da
  // UI mas continuam DENTRO do "todos" — por isso o toggle materializa a completa: sair
  // de "todos" desmarcando um chip não pode fazer obra terminal sumir em silêncio.
  const allPublicationStatuses = useMemo(
    () => dedupeStatusOptions(publicationStatuses),
    [publicationStatuses]
  )
  const visiblePublicationStatuses = allPublicationStatuses
  const allPersonalStatuses = useMemo(
    () => dedupeStatusOptions(personalStatuses),
    [personalStatuses]
  )
  // Filtra os status pessoais — Completed e Dropped nunca aparecem
  const visiblePersonalStatuses = useMemo(
    () => allPersonalStatuses.filter((s) => !HIDDEN_PERSONAL_STATUSES.has(s.status)),
    [allPersonalStatuses]
  )

  // "all" = a página não tem filtro padrão de status (ausente no servidor já mostra
  // tudo) — os defaults viram a lista COMPLETA de opções, pra ausência de parâmetro se
  // comportar exatamente como o "Todos" explícito (chips todos marcados, e clicar um
  // deles DESMARCA em vez de somar a uma seleção mínima). Ver doc da prop.
  const pubStatusDefaultsAll = defaultPublicationStatus === "all"
  const pubStatusDefaults = Array.isArray(defaultPublicationStatus)
    ? defaultPublicationStatus
    : pubStatusDefaultsAll
      ? allPublicationStatuses.map((o) => o.status)
      : ["Completed"]
  const perStatusDefaultsAll = defaultPersonalStatus === "all"
  const perStatusDefaults = Array.isArray(defaultPersonalStatus)
    ? defaultPersonalStatus
    : perStatusDefaultsAll
      ? allPersonalStatuses.map((o) => o.status)
      : [...UNREAD_PERSONAL_STATUSES]

  /**
   * Põe um status na regra pedida. A regra inteira (exclusividade entre incluir e
   * excluir, forma canônica do `"all"`, o que fazer ao sair do modo exclusão) mora em
   * `setStatusRule` — aqui só se sabe QUAL chip foi clicado e para onde ele vai.
   */
  const applyStatusRule = (
    kind: StatusFilterKind,
    status: string,
    rule: StatusRule,
    options: StatusOption[],
    defaults: readonly string[]
  ) => {
    const keys = STATUS_FILTER_PARAMS[kind]
    updateParams(
      setStatusRule(
        kind,
        { include: searchParams.get(keys.include), exclude: searchParams.get(keys.exclude) },
        status,
        rule,
        options.map((o) => o.status),
        defaults
      )
    )
  }

  const pubExcluded = csvSet("pub_status_exclude")
  const perExcluded = csvSet("per_status_exclude")
  const pubStatusParam = searchParams.get("pub_status")
  // Explícito ("all" literal na URL) vs. silencioso (parâmetro ausente E a página não
  // tem filtro padrão) — só o primeiro deve virar chip em "Filtros ativos": o segundo
  // não é uma escolha de ninguém, é só o estado inicial, e mostrar um chip "Todos"
  // removível pra ele contradiz "sem filtro nenhum aplicado por padrão".
  // ⚠️ Excluindo, NENHUM chip fica marcado: a dimensão está no modo negativo, e um
  // "todos marcados menos os riscados" diria que os outros foram escolhidos a dedo —
  // que é justamente a leitura que a exclusão veio desfazer.
  const pubStatusExplicitAll = pubStatusParam === "all"
  const isAllPublication =
    !pubExcluded.size && (pubStatusExplicitAll || (pubStatusParam == null && pubStatusDefaultsAll))
  const selectedPublicationStatuses = pubExcluded.size
    ? new Set<string>()
    : isAllPublication
      ? new Set<string>()
      : pubStatusParam != null
        ? csvSet("pub_status")
        : new Set<string>(pubStatusDefaults)

  const setPublicationRule = (status: string, rule: StatusRule) =>
    applyStatusRule("publication", status, rule, allPublicationStatuses, pubStatusDefaults)

  const perStatusParam = searchParams.get("per_status")
  const perStatusExplicitAll = perStatusParam === "all"
  const isAllPersonal =
    !perExcluded.size && (perStatusExplicitAll || (perStatusParam == null && perStatusDefaultsAll))
  const selectedPerStatuses = perExcluded.size
    ? new Set<string>()
    : isAllPersonal
      ? new Set<string>()
      : perStatusParam != null
        ? csvSet("per_status")
        : new Set<string>(perStatusDefaults)

  const setPersonalRule = (status: string, rule: StatusRule) =>
    applyStatusRule("personal", status, rule, allPersonalStatuses, perStatusDefaults)

  /**
   * Modo de exclusão, por card. Só a escolha MANUAL mora em state; o modo em vigor é
   * derivado (`manual || já há exclusão`) para que exclusão vinda de fora — preset
   * salvo, link colado, voltar do browser — nunca fique valendo com o controle
   * apagado. Ver `ExcludeModeToggle`.
   */
  const [pubExcludeManual, setPubExcludeManual] = useState(false)
  const [perExcludeManual, setPerExcludeManual] = useState(false)
  const pubExcludeOn = pubExcludeManual || pubExcluded.size > 0
  const perExcludeOn = perExcludeManual || perExcluded.size > 0
  const toggleExcludeMode = (kind: StatusFilterKind) => {
    const on = kind === "publication" ? pubExcludeOn : perExcludeOn
    const setManual = kind === "publication" ? setPubExcludeManual : setPerExcludeManual
    setManual(!on)
    // Desligando: as exclusões saem junto — modo fechado com filtro de pé é filtro
    // sem controle na tela.
    if (on) updateParams({ [STATUS_FILTER_PARAMS[kind].exclude]: null })
  }

  // O contador do cabeçalho conta só os status VISÍVEIS: a seleção pode carregar os
  // terminais (que não têm chip), e "(11)" com 10 chips na tela é contador fantasma.
  const selectedVisiblePerCount = visiblePersonalStatuses.filter((s) =>
    selectedPerStatuses.has(s.status)
  ).length

  const [genreSearch, setGenreSearch] = useState("")
  const filteredGenres = useMemo(
    () =>
      availableGenres.filter((g) => g.toLowerCase().includes(genreSearch.toLowerCase())),
    [availableGenres, genreSearch]
  )
  // Split por cat_type: Demografia (topo) × Gêneros. Só quando genreCatTypes veio
  // (/ranking); sem ele, cai no grid único mais abaixo (favorites etc.).
  const demographicGenres = useMemo(
    () => filteredGenres.filter((g) => (genreCatTypes?.[g] ?? "category") === "demographics"),
    [filteredGenres, genreCatTypes]
  )
  const categoryGenres = useMemo(
    () => filteredGenres.filter((g) => (genreCatTypes?.[g] ?? "category") !== "demographics"),
    [filteredGenres, genreCatTypes]
  )
  const [tagSearch, setTagSearch] = useState("")
  const filteredTags = useMemo(
    () =>
      availableTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase())),
    [availableTags, tagSearch]
  )
  const filteredTagChoices = useMemo(
    () => filteredTags.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      groupName: tag.groupName ?? "Sem grupo",
      subGroupName: tag.subGroupName,
    })),
    [filteredTags]
  )
  const allTagChoices = useMemo(
    () => availableTags.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      groupName: tag.groupName ?? "Sem grupo",
      subGroupName: tag.subGroupName,
    })),
    [availableTags]
  )
  const tagNameBySlug = useMemo(
    () => new Map(availableTags.map((tag) => [tag.slug, tag.name])),
    [availableTags]
  )

  const activeFilterChips: ActiveFilterChip[] = []
  const pushRangeChip = (
    key: string,
    label: string,
    minKey: string,
    maxKey: string,
    /** Converte o valor da URL (pontos) pro texto exibido — usado pela lente σ. */
    fmt?: (raw: string) => string,
  ) => {
    const min = searchParams.get(minKey)
    const max = searchParams.get(maxKey)
    if (!min && !max) return
    // Override =0 desliga um pré-filtro de preferência; ">= 0" não é filtro real.
    if (min === "0" && !max) return
    const f = fmt ?? ((raw: string) => raw)
    const suffix = min && max ? `${f(min)}–${f(max)}` : min ? `≥ ${f(min)}` : `≤ ${f(max as string)}`
    activeFilterChips.push({
      key,
      label,
      values: [{ text: suffix }],
      onClear: () => updateParams({ [minKey]: null, [maxKey]: null }),
    })
  }

  if (searchParams.has("top_n") && searchParams.get("top_n") !== "0") {
    activeFilterChips.push({
      key: "top_n",
      label: "Top N",
      values: [{ text: searchParams.get("top_n") as string }],
      onClear: () => updateParams({ top_n: null }),
    })
  }
  if (showArtFilter && artMode !== "off") {
    // Chip com o rótulo CURTO e o "(est.)" preservado: sem ele, a barra de filtros ativos
    // afirmaria "Arte forte" como fato, que é a única leitura que a medição não sustenta.
    activeFilterChips.push({
      key: "art",
      label: "Arte (estimada)",
      values: [{ text: ART_FILTER_CHIP_LABELS[artMode] }],
      onClear: () => updateParams({ [ART_FILTER_PARAM]: null }),
    })
  }
  pushRangeChip("chapters", LABELS.chapters_total.short, "min_chapters", "max_chapters")
  pushRangeChip("year", LABELS.year.short, "min_year", "max_year")
  pushRangeChip("expected", LABELS.expected_score.full, "min_expected", "max_expected")
  pushRangeChip("fit", LABELS.personal_fit.full, "min_fit", "max_fit")
  pushRangeChip("align", LABELS.alignment_score.full, "min_align", "max_align")
  pushRangeChip("platform", LABELS.platform_avg.full, "min_platform_avg", "max_platform_avg")
  pushRangeChip("votes", LABELS.total_votes.full, "min_votes", "max_votes")
  for (const slug of CRITERION_SLUGS) {
    // Com a lente ligada o chip fala σ, igual ao pill. O valor guardado segue em
    // pontos — quem traduz é só a exibição. Sem momento pro slug, fica em pontos.
    const m = criterionMoments?.[slug]
    const fmt =
      criterionUnit === "sd" && m && m.sd > 0
        ? (raw: string) => {
            const z = scoreToSigma(parseFloat(raw), m)
            return z == null ? raw : fmtSigma(z)
          }
        : undefined
    pushRangeChip(`crit-${slug}`, CRITERION_LABELS[slug] ?? slug, `min_${slug}`, `max_${slug}`, fmt)
  }
  if (searchParams.get("rated") === "1") {
    activeFilterChips.push({
      key: "rated",
      label: "Só avaliadas",
      onClear: () => updateParams({ rated: null }),
    })
  }
  /**
   * UM chip por dimensão de status, com os valores dentro.
   *
   * A exclusão agora é uma escolha própria (`*_status_exclude`), então o chip diz
   * "Publicação exceto ~~Cancelled~~" — riscado, a mesma marca do pill no painel. A
   * inferência antiga ("todos menos X" deduzido de uma seleção quase-completa) sumiu
   * junto: ela só aparecia quando as exclusões eram minoria e, pior, escondia que o
   * filtro era uma LISTA — que ignora status novos que entrem na tabela depois.
   */
  const pushStatusChips = (
    prefix: string,
    label: string,
    kind: StatusFilterKind,
    selected: Set<string>,
    excluded: Set<string>,
    isExplicitAll: boolean,
    setRule: (status: string, rule: StatusRule) => void
  ) => {
    const keys = STATUS_FILTER_PARAMS[kind]
    if (excluded.size > 0) {
      activeFilterChips.push({
        key: `${prefix}-except`,
        label: `${label} exceto`,
        tone: "exclude",
        values: [...excluded].map((status) => ({
          text: status,
          struck: true,
          onRemove: () => setRule(status, null),
        })),
        onClear: () => updateParams({ [keys.exclude]: null }),
      })
      return
    }
    if (isExplicitAll) {
      activeFilterChips.push({
        key: `${prefix}-all`,
        label: `${label}: Todos`,
        onClear: () => updateParams({ [keys.include]: null }),
      })
      return
    }
    if (selected.size === 0) return
    activeFilterChips.push({
      key: `${prefix}-in`,
      label,
      values: [...selected].map((status) => ({
        text: status,
        onRemove: () => setRule(status, null),
      })),
      onClear: () => updateParams({ [keys.include]: null, [keys.exclude]: null }),
    })
  }

  pushStatusChips(
    "pub",
    "Publicação",
    "publication",
    selectedPublicationStatuses,
    pubExcluded,
    pubStatusExplicitAll,
    setPublicationRule
  )
  pushStatusChips(
    "personal",
    "Status",
    "personal",
    selectedPerStatuses,
    perExcluded,
    perStatusExplicitAll,
    setPersonalRule
  )
  /**
   * Interesse manual e previsto: UM chip por dimensão, com o nome que o painel usa.
   *
   * Antes eram quatro rótulos para duas dimensões — `Sinopse:` e `Interesse:` saíam do
   * MESMO controle (`synopsis_q` + a sentinela), e `Prev. sinopse:`/`Prev. IA:` do
   * mesmo par. Nenhum deles era o nome da seção ("Interesse na obra", linhas Manual e
   * Int. Prev.), então quem quisesse desfazer procurava no painel um bloco "Sinopse"
   * que não existe.
   */
  const pushInterestChip = (
    key: string,
    label: string,
    tone: "loved" | "predicted",
    param: string,
    qualities: Set<string>,
    otherActive: boolean,
    otherLabel: string,
    toggleOther: () => void
  ) => {
    const values: ActiveFilterValue[] = []
    for (const quality of qualities) {
      // A sentinela vira o valor por extenso, no fim — senão a barra mostraria
      // "none", que não é nome de nada na UI. Um "unknown" sobrando de filtro salvo
      // antigo cai aqui também e some da barra, como já some do resultado.
      if (quality === INTEREST_NONE || quality === "unknown") continue
      values.push({ text: quality, onRemove: () => toggleCsv(param, quality) })
    }
    if (otherActive) values.push({ text: otherLabel, onRemove: toggleOther })
    if (values.length === 0) return
    activeFilterChips.push({
      key,
      label,
      tone,
      values,
      onClear: () => updateParams({ [param]: null }),
    })
  }

  pushInterestChip(
    "interest",
    "Interesse",
    "loved",
    "synopsis_q",
    selectedSynopsisQ,
    manualOtherActive,
    "sem avaliação",
    toggleManualOther
  )
  pushInterestChip(
    "interest-pred",
    LABELS.synopsis_pred.abbrev,
    "predicted",
    "synopsis_pred",
    selectedSynopsisPred,
    predOtherActive,
    "sem previsão",
    togglePredOther
  )

  /**
   * Gêneros e tags: um chip por REGRA (AND · OR · NOT), com a cor que o grid do painel
   * já ensina — verde obrigatória, azul opcional, rosa excluída. Antes a regra vinha
   * como prefixo textual (`+ Tag:`, `Tag opcional:`, `- Tag:`) e todos os chips eram
   * cinza: a pista visual que o usuário aprendeu no grid era jogada fora na barra.
   */
  const pushFacetChips = (
    prefix: string,
    label: string,
    rule: "all" | "any" | "exclude",
    tone: "include" | "optional" | "exclude",
    selected: Set<string>,
    nameOf: (value: string) => string,
    clearOne: (value: string) => void
  ) => {
    if (selected.size === 0) return
    activeFilterChips.push({
      key: `${prefix}-${rule}`,
      label: rule === "any" ? `${label} ou` : rule === "exclude" ? `${label} exceto` : label,
      tone,
      values: [...selected].map((value) => ({
        text: nameOf(value),
        struck: rule === "exclude",
        onRemove: () => clearOne(value),
      })),
      onClear: () => selected.forEach((value) => clearOne(value)),
    })
  }

  const genreName = (genre: string) => genre
  pushFacetChips("genre", "Gênero", "all", "include", selectedGenreAll, genreName, (g) => setGenreRule(g, null))
  pushFacetChips("genre", "Gênero", "any", "optional", selectedGenreAny, genreName, (g) => setGenreRule(g, null))
  pushFacetChips("genre", "Gênero", "exclude", "exclude", selectedGenreExclude, genreName, (g) => setGenreRule(g, null))
  const tagName = (slug: string) => tagNameBySlug.get(slug) ?? slug
  pushFacetChips("tag", "Tag", "all", "include", selectedTagAll, tagName, (s) => setTagRule(s, null))
  pushFacetChips("tag", "Tag", "any", "optional", selectedTagAny, tagName, (s) => setTagRule(s, null))
  pushFacetChips("tag", "Tag", "exclude", "exclude", selectedTagExclude, tagName, (s) => setTagRule(s, null))

  // O contador conta VALORES, não chips: agrupar não pode fazer "12 seleções" virar
  // "6 seleções" sem que nada tenha sido desfeito.
  const activeFilterCount = activeFilterChips.reduce(
    (total, chip) => total + Math.max(1, chip.values?.length ?? 1),
    0
  )
  const activeFilterLabel = activeFilterCount === 1 ? "1 seleção" : `${activeFilterCount} seleções`

  return (
    <div className="rounded-xl border border-border/70 bg-card/58 p-4 shadow-sm shadow-black/5 backdrop-blur">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CollapseIconTrigger
            onToggle={toggleCollapsed}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
          >
            <Filter className="h-4 w-4" />
          </CollapseIconTrigger>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                <CollapseTitleTrigger collapsed={collapsed} onToggle={toggleCollapsed}>
                  Filtros
                </CollapseTitleTrigger>
              </h2>
              {activeFilterChips.length > 0 && (
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {activeFilterLabel}
                </span>
              )}
              {appliedPreset && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  title={`Filtro salvo aplicado: ${appliedPreset.name}`}
                >
                  <Bookmark className="h-3 w-3" />
                  {appliedPreset.name}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ajuste os critérios e aplique quando terminar.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!collapsed && (
            <SavedFiltersControl
              presets={presets}
              basePath={basePath}
              currentQuery={draftSearch}
              onApply={applyPreset}
              onChange={setPresets}
            />
          )}
          {!collapsed && (
            <Button size="sm" onClick={applyAllFilters} disabled={isApplying || !filtersDirty}>
              {isApplying ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Aplicando…
                </>
              ) : (
                "Aplicar filtros"
              )}
            </Button>
          )}
          {!collapsed && hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Mostrar filtros" : "Ocultar filtros"}
            title={collapsed ? "Mostrar filtros" : "Ocultar filtros"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
      <Tabs defaultValue="geral" className="gap-4">
        <TabsList className="!h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-background/40 p-1 [scrollbar-width:none] xl:grid xl:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="geral" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Geral</TabsTrigger>
          <TabsTrigger value="notas" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Notas</TabsTrigger>
          <TabsTrigger value="generos" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Gêneros</TabsTrigger>
          <TabsTrigger value="tags" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Tags</TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <div className="grid gap-3">
            {/* LINHA 1: Publicação · Status pessoal · Critérios gerais (numéricos).
                Larguras calibradas p/ cada container caber em 2 linhas: Publicação
                (5 pills → 3/linha), Status pessoal (10 pills → 5/linha), Critérios enxuto.
                Sem "Obras exibidas" (roomy) o 3º card carrega só Caps+Ano (194px de
                conteúdo medido) — a trilha encolhe e a largura vai pros pills. */}
            <div
              className="grid gap-3 lg:[grid-template-columns:var(--l1cols)] 2xl:[grid-template-columns:var(--l1cols2xl)]"
              style={
                {
                  ["--l1cols"]: l1ColsBase,
                  /**
                   * ⚠️ A partir de `2xl` Publicação ganha 0,15fr do Status pessoal —
                   * mas SÓ com o modo de exclusão ligado.
                   *
                   * A zona "−" engorda cada pill em ~22px, e Publicação (o card mais
                   * estreito) cai de 3 pills por linha para 2 — 3 linhas onde a
                   * calibragem original previa 2. Esta transferência existe para pagar
                   * exatamente esses 22px: com a zona desligada ela não tem o que
                   * compensar e passa a tirar largura do card de 10 pills à toa. Por
                   * isso é DERIVADA do modo, e não uma segunda calibragem fixa.
                   *
                   * 🔴 Por que só em `2xl`, e não sempre: medido nas quatro larguras, a
                   * transferência é de graça em 1600+ (Publicação 3→2 linhas, altura da
                   * linha intacta em 205px) e CARA em 1280 (o Status pessoal, com 10
                   * pills, cai pra 4 linhas e a linha vai a 245px) — sem ganho nenhum lá,
                   * porque Publicação segue em 3 linhas de qualquer jeito. Não existe
                   * valor único que ganhe nos dois: em 1280 o Status pessoal já está no
                   * limite. Daí o breakpoint, em vez de escolher qual largura sacrificar.
                   */
                  ["--l1cols2xl"]:
                    pubExcludeOn || perExcludeOn ? l1ColsExcludeMode : l1ColsBase,
                } as CSSProperties
              }
            >
            <FilterSection
              title={`Publicação${
                pubExcluded.size
                  ? ` (exceto ${pubExcluded.size})`
                  : isAllPublication
                    ? " (todos)"
                    : selectedPublicationStatuses.size
                      ? ` (${selectedPublicationStatuses.size})`
                      : ""
              }`}
              headerAction={
                <div className="flex items-center gap-1.5">
                  <ExcludeModeToggle
                    on={pubExcludeOn}
                    onToggle={() => toggleExcludeMode("publication")}
                    dimension="de publicação"
                    activeCount={pubExcluded.size}
                  />
                  <button
                    type="button"
                    // "Todos" tem que zerar os DOIS params: só apagar o positivo deixaria
                    // a exclusão de pé por baixo de um badge que promete o catálogo todo.
                    onClick={() =>
                      updateParams({
                        pub_status: isAllPublication ? null : "all",
                        pub_status_exclude: null,
                      })
                    }
                  >
                    <Badge
                      variant={isAllPublication ? "default" : "outline"}
                      className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                    >
                      Todos
                    </Badge>
                  </button>
                </div>
              }
            >
              {/* gap-1.5: cada 2px entre pills vale ~14px de linha nos 10 status pessoais. */}
              <div className="flex flex-wrap gap-1.5">
                {visiblePublicationStatuses.map((s) => {
                  const on = isAllPublication || selectedPublicationStatuses.has(s.status)
                  const off = pubExcluded.has(s.status)
                  return (
                    <StatusButton
                      key={`publication-${s.status}`}
                      option={s}
                      active={on}
                      excluded={off}
                      onClick={() => setPublicationRule(s.status, on ? null : "include")}
                      onExclude={
                        pubExcludeOn
                          ? () => setPublicationRule(s.status, off ? null : "exclude")
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </FilterSection>

            <FilterSection
              title={`Status pessoal${
                perExcluded.size
                  ? ` (exceto ${perExcluded.size})`
                  : isAllPersonal
                    ? " (todos)"
                    : selectedVisiblePerCount
                      ? ` (${selectedVisiblePerCount})`
                      : ""
              }`}
              headerAction={
                <div className="flex items-center gap-1.5">
                  <ExcludeModeToggle
                    on={perExcludeOn}
                    onToggle={() => toggleExcludeMode("personal")}
                    dimension="pessoais"
                    activeCount={perExcluded.size}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateParams({
                        per_status: isAllPersonal ? null : "all",
                        per_status_exclude: null,
                      })
                    }
                  >
                    <Badge
                      variant={isAllPersonal ? "default" : "outline"}
                      className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                    >
                      Todos
                    </Badge>
                  </button>
                </div>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {visiblePersonalStatuses.map((s) => {
                  const on = isAllPersonal || selectedPerStatuses.has(s.status)
                  const off = perExcluded.has(s.status)
                  return (
                    <StatusButton
                      key={`personal-${s.status}`}
                      option={s}
                      active={on}
                      excluded={off}
                      tooltip={getPersonalStatusDescription(s.status, s.comment)}
                      onClick={() => setPersonalRule(s.status, on ? null : "include")}
                      onExclude={
                        perExcludeOn
                          ? () => setPersonalRule(s.status, off ? null : "exclude")
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </FilterSection>

            {/* Critérios gerais — só os numéricos (Caps · Ano · Obras exibidas) */}
            <FilterSection
              title="Critérios gerais"
              className="flex flex-col"
              contentClassName="flex-1 flex flex-col justify-center"
            >
              <div className="flex items-stretch justify-center gap-x-7 gap-y-4">
                <div className="flex flex-col justify-center gap-3">
                  {/* Capítulos */}
                  <div className="flex items-center gap-2">
                    <Label className="w-10 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Caps
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0}
                        placeholder="Mín"
                        size="sm"
                        className="w-16 text-center h-8"
                        value={searchParams.get("min_chapters") ?? ""}
                        onChange={(e) => updateParams({ min_chapters: e.target.value || null })}
                      />
                      <span className="text-xs font-semibold text-muted-foreground shrink-0">-</span>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Máx"
                        size="sm"
                        className="w-16 text-center h-8"
                        value={searchParams.get("max_chapters") ?? ""}
                        onChange={(e) => updateParams({ max_chapters: e.target.value || null })}
                      />
                    </div>
                  </div>
                  {/* Ano */}
                  <div className="flex items-center gap-2">
                    <Label className="w-10 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ano
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        placeholder="Mín"
                        size="sm"
                        className="w-16 text-center h-8"
                        value={searchParams.get("min_year") ?? ""}
                        onChange={(e) => updateParams({ min_year: e.target.value || null })}
                      />
                      <span className="text-xs font-semibold text-muted-foreground shrink-0">-</span>
                      <Input
                        type="number"
                        placeholder="Máx"
                        size="sm"
                        className="w-16 text-center h-8"
                        value={searchParams.get("max_year") ?? ""}
                        onChange={(e) => updateParams({ max_year: e.target.value || null })}
                      />
                    </div>
                  </div>
                </div>

                {/* Obras exibidas — divisória + rótulo em cima, input embaixo, à direita */}
                {showTopN && (
                  <div className="flex items-center gap-x-5 shrink-0">
                    <div className="w-px self-stretch bg-border/60" />
                    <div className="flex flex-col items-center gap-1.5">
                    <Label className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center leading-tight">
                      Obras exibidas
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      placeholder="Todas"
                      size="sm"
                      className="w-16 text-center h-8"
                      value={(urlTopN && urlTopN > 0 ? urlTopN : null) ?? defaultTopN ?? ""}
                      onChange={(e) => updateParams({ top_n: e.target.value || null })}
                    />
                    </div>
                  </div>
                )}
              </div>
            </FilterSection>
            </div>

            {/* LINHA 2: Interesse na obra · Conteúdo exibido · Largura dos tiers · Ordenação */}
            <div
              // Lado a lado só a partir de `xl`. Em `lg` a linha vira 2 colunas —
              // com quatro trilhas em 1024px cada card fica com ~210px, e o
              // segmentado de "Conteúdo 18+" sozinho mede 210px: ele estourava a
              // caixa em 26px, medido nos DOIS ramos. Era `xl` só no ramo `roomy`;
              // o outro tentava quatro colunas já em `lg` e quebrava igual.
              className="grid gap-3 lg:grid-cols-2 xl:[grid-template-columns:var(--l2cols)]"
              style={
                {
                  // Sem "Largura dos tiers" a linha perde um card: as trilhas do
                  // /ranking deixariam Interesse e Conteúdo exibido com ~1/3 vazio.
                  // Os mínimos em px são o conteúdo medido + padding — sem eles o fr
                  // encolhe abaixo do que os controles ocupam, e o card estoura.
                  // ⚠️ A Ordenação virou TRILHA horizontal (chips que quebram
                  // linha), e aí LARGURA vale ALTURA — o grid estica a linha
                  // toda, então o card mais alto empurra os outros três junto.
                  // Altura da linha em 1600px com 5 níveis de ordenação:
                  //   pilha antiga, 1,05fr   201px → 357px  (+52px por nível)
                  //   trilha,       1,05fr   183px → 267px
                  //   trilha,       1,30fr   183px → 221px  (+12,7px por nível)
                  //
                  // A folga saiu de "Largura dos tiers" (0,95 → 0,7fr), que é o
                  // card de conteúdo mais fixo. Duas tentativas foram medidas e
                  // descartadas, e as duas falhavam FORA de 1600px:
                  //   • tirar de "Conteúdo exibido" (1,35 → 1,15fr) → ele passa a
                  //     estourar também em 1440, não só em 1100/1280;
                  //   • tirar de "Interesse na obra" → abaixo de 318px os ♥
                  //     quebram linha e a linha inteira vai a 373px, em QUALQUER
                  //     número de níveis (inclusive dois).
                  // Daí os pisos em px: sem eles o `fr` encolhe abaixo do que o
                  // conteúdo ocupa e o card estoura sem nada acusar.
                  //
                  // ⚠️ O estouro de "Conteúdo exibido" em 1100/1280 é ANTERIOR a
                  // isto (medido nas duas versões) — não foi introduzido aqui.
                  ["--l2cols"]: [
                    roomy ? "minmax(410px,1.15fr)" : "minmax(318px,1.6fr)",
                    showHideAvoided || showArtFilter || showAdultFilter
                      ? roomy
                        ? "minmax(350px,1fr)"
                        : "minmax(0,1.3fr)"
                      : null,
                    showTierBand ? "minmax(160px,0.7fr)" : null,
                    roomy ? "minmax(260px,1fr)" : "minmax(0,1.3fr)",
                  ]
                    .filter(Boolean)
                    .join(" "),
                } as CSSProperties
              }
            >
              <FilterSection
                title="Interesse na obra"
                className="flex flex-col"
                contentClassName={`flex-1 flex flex-col justify-center ${roomy ? "2xl:px-7" : ""}`}
              >
                {/* Sobrando largura (roomy), a folga vai PARA ENTRE os dois grupos —
                    a divisória encosta no bloco "Combinar", à direita, em vez de
                    deixar um buraco no fim do card. O teto de largura é o que impede
                    o efeito colateral quando o card fica MUITO largo (a linha de 2
                    colunas em `lg`): ali o bloco centraliza em vez de esticar, senão
                    o "Combinar" ia parar a 400px dos ♥. */}
                <div
                  className={`flex items-stretch gap-6 ${
                    roomy ? "mx-auto w-full max-w-[480px] justify-between" : "justify-start"
                  }`}
                >
                  <div className="flex flex-col justify-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Manual
                      </Label>
                      <QualityToggles
                        values={SYNOPSIS_QUALITIES}
                        selected={selectedSynopsisQ}
                        onToggle={(q) => toggleCsv("synopsis_q", q)}
                        tone="rose"
                        extra={
                          <InterestOtherToggle
                            active={manualOtherActive}
                            onToggle={toggleManualOther}
                            tone="rose"
                            label="Sem avaliação — obras que você ainda não pontuou"
                          />
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label className="w-16 shrink-0 cursor-help text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {LABELS.synopsis_pred.abbrev}
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            {LABELS.synopsis_pred.tooltip_full}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <QualityToggles
                        values={SYNOPSIS_QUALITIES}
                        selected={selectedSynopsisPred}
                        onToggle={(q) => toggleCsv("synopsis_pred", q)}
                        tone="salmon"
                        extra={
                          <InterestOtherToggle
                            active={predOtherActive}
                            onToggle={togglePredOther}
                            tone="salmon"
                            label="Sem previsão — obras sem previsão de interesse para o seu perfil"
                          />
                        }
                      />
                    </div>
                  </div>
                  {/* Combinar — divisória + rótulo em cima, toggle embaixo, à direita */}
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="w-px self-stretch bg-border/60" />
                    <div className="flex flex-col items-center gap-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Combinar
                      </Label>
                      <InterestModeToggle
                        mode={interestMode}
                        onChange={(m) => updateParams({ synopsis_mode: m === "and" ? "and" : null })}
                        active={selectedSynopsisQ.size > 0 && selectedSynopsisPred.size > 0}
                      />
                    </div>
                  </div>
                </div>
              </FilterSection>

              {/* Conteúdo exibido — filtros que escondem/mostram obras (tags evitadas + 18+) */}
              {(showHideAvoided || showArtFilter || showAdultFilter) && (
                <FilterSection
                  title="Conteúdo exibido"
                  className="flex flex-col"
                  contentClassName={`flex-1 flex flex-col justify-center ${roomy ? "2xl:px-7" : ""}`}
                >
                  <div className={`flex flex-col gap-3.5 ${roomy ? "mx-auto w-full max-w-[380px]" : ""}`}>
                    {showHideAvoided && (
                      /* Esconder tags evitadas — esconde obras com tags declaradas como evitadas */
                      // ⚠️ `flex-wrap`: o rótulo tem largura fixa e o segmentado NÃO
                      // encolhe (os três rótulos não truncam), então numa trilha
                      // estreita a linha não tinha pra onde ceder e o card
                      // ESTOURAVA — medido em 26px a 1100px, e também a 1280px.
                      // Quebrar linha põe o segmentado embaixo do rótulo: o card
                      // fica mais alto, que numa linha de grid já esticada é de
                      // graça, e nada some da tela.
                      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${roomy ? "justify-between" : ""}`}>
                        <Label
                          className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-tight"
                          title="Esconde obras com tags que você declarou evitar (em /preferencias). Fortes = só as marcadas 2×."
                        >
                          Esconder<br />tags evitadas
                        </Label>
                        <TooltipProvider delayDuration={150} disableHoverableContent>
                          <div className="inline-flex rounded-md border border-border/70 bg-background/60 p-0.5">
                            <HideAvoidedSegment
                              onSelect={() => updateParams({ hide_avoided: null })}
                              active={hideAvoidedMode === "off"}
                              label="Não"
                              tooltip="Não esconde nada; mostra todas as obras."
                            />
                            <HideAvoidedSegment
                              onSelect={() => updateParams({ hide_avoided: "strong" })}
                              active={hideAvoidedMode === "strong"}
                              label="Fortes"
                              tooltip="Esconde obras com tags evitadas marcadas como fortes (2×)."
                            />
                            <HideAvoidedSegment
                              onSelect={() => updateParams({ hide_avoided: "all" })}
                              active={hideAvoidedMode === "all"}
                              label="Todas"
                              tooltip="Esconde obras com qualquer tag evitada."
                            />
                          </div>
                        </TooltipProvider>
                      </div>
                    )}

                    {/*
                      Arte ESTIMADA. É estimativa a partir de tags, reviews e do eixo "arte" do
                      digest — nunca a arte olhada. Por isso o controle é de FAIXA e não de
                      número: a estimativa é comprimida a ~0,49x a escala do rótulo, e um
                      limiar em pontos devolveria 56% do catálogo onde a taxa real é 75%.

                      🔴 Os dois lados tratam "sem estimativa" ao contrário — está nos tooltips
                      porque é a diferença que a pessoa não tem como deduzir da tela.
                    */}
                    {showArtFilter && (
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${roomy ? "justify-between" : ""}`}>
                      <Label
                        className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-tight"
                        title="Estimativa de quanto você tende a gostar da arte, inferida de tags, reviews e do resumo de reviews. Não é uma avaliação da arte — e obra sem sinal fica sem estimativa."
                      >
                        Arte<br />(estimada)
                      </Label>
                      <TooltipProvider delayDuration={150} disableHoverableContent>
                        <div className="inline-flex rounded-md border border-border/70 bg-background/60 p-0.5">
                          <HideAvoidedSegment
                            onSelect={() => updateParams({ [ART_FILTER_PARAM]: null })}
                            active={artMode === "off"}
                            label="Tudo"
                            tooltip="Não filtra por arte."
                          />
                          <HideAvoidedSegment
                            onSelect={() => updateParams({ [ART_FILTER_PARAM]: "forte" })}
                            active={artMode === "forte"}
                            label="Forte"
                            tooltip="Só o topo 20% da estimativa. Obra SEM estimativa fica de fora — ninguém apurou que a arte dela é forte."
                          />
                          <HideAvoidedSegment
                            onSelect={() => updateParams({ [ART_FILTER_PARAM]: "sem_fraca" })}
                            active={artMode === "sem_fraca"}
                            label="Sem fraca"
                            tooltip="Esconde o fundo 20% da estimativa. Obra SEM estimativa CONTINUA aparecendo — esconder o que nunca foi medido tiraria obra da lista sem motivo."
                          />
                        </div>
                      </TooltipProvider>
                    </div>
                    )}

                    {showAdultFilter && (
                      /* Conteúdo 18+ — filtra pela classificação da obra (is_adult), não por tags */
                      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${roomy ? "justify-between" : ""}`}>
                        <Label
                          className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-tight"
                          title="Filtra obras 18+ pela classificação da obra (o mesmo selo 🔞 da página da obra), não pelas tags. 'Tudo' respeita sua preferência global."
                        >
                          Conteúdo 18+
                        </Label>
                        <AdultContentSegment
                          value={
                            searchParams.get("adult") === "hide"
                              ? "hide"
                              : searchParams.get("adult") === "only"
                                ? "only"
                                : "all"
                          }
                          onChange={(v) => updateParams({ adult: v === "all" ? null : v })}
                        />
                      </div>
                    )}
                  </div>
                </FilterSection>
              )}

              {/* Largura dos tiers — movida da linha 1 pra cá */}
              {showTierBand && (
                <TierBandSection
                  searchParams={searchParams}
                  updateParams={updateParams}
                  defaultBand={defaultBand}
                  className="flex flex-col"
                  contentClassName="flex-1 flex flex-col justify-center"
                />
              )}

              <SortLevelsSection
                searchParams={searchParams}
                updateParams={updateParams}
                defaultSort={defaultSort}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notas">
          <div className="grid gap-3 xl:grid-cols-2">
            <ScorePillGroup
              title="Notas por critério"
              defs={criterionScoreDefs}
              cols={2}
              searchParams={searchParams}
              updateParams={updateParams}
              headerAction={
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                  {/* Faixas ideais do perfil viram limiares nos nove pills abaixo.
                      Some sozinho quando não há perfil. */}
                  {criterionRanges && (
                    <MyRangeToggle
                      ranges={criterionRanges}
                      searchParams={searchParams}
                      updateParams={updateParams}
                    />
                  )}
                  {/* `undefined` = a página não oferece a lente (ex: /favorites, que
                      não busca os momentos) → some com o seletor. `null` = ela
                      oferece mas a leitura falhou → seletor desabilitado, com a
                      explicação. Um estado só pros dois fazia o /favorites acusar
                      uma falha que nunca houve. */}
                  {criterionMoments !== undefined && (
                    <CriterionUnitToggle
                      unit={criterionUnit}
                      updateParams={updateParams}
                      moments={criterionMoments}
                    />
                  )}
                </div>
              }
            />
            <ScorePillGroup
              title="Notas gerais"
              defs={GENERAL_SCORE_DEFS}
              cols={2}
              searchParams={searchParams}
              updateParams={updateParams}
              confidenceVotes={confidenceVotes}
            />
          </div>
        </TabsContent>

        <TabsContent value="generos">
          <FilterSection
            title={`Gêneros${
              selectedGenreAll.size + selectedGenreAny.size + selectedGenreExclude.size
                ? ` (${selectedGenreAll.size + selectedGenreAny.size + selectedGenreExclude.size})`
                : ""
            }`}
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar gênero..."
                className="h-9 pl-9 text-sm"
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
              />
            </div>
            {genreCatTypes ? (
              <div className="space-y-4">
                <FacetLegend />
                {demographicGenres.length > 0 && (
                  <div className="space-y-2">
                    <GenreGroupLabel label="Demografia" count={demographicGenres.length} />
                    <GenreRuleGrid
                      items={demographicGenres}
                      selectedAll={selectedGenreAll}
                      selectedAny={selectedGenreAny}
                      selectedExclude={selectedGenreExclude}
                      onSetRule={setGenreRule}
                      showLegend={false}
                    />
                  </div>
                )}
                {categoryGenres.length > 0 && (
                  <div className="space-y-2">
                    <GenreGroupLabel label="Gêneros" count={categoryGenres.length} />
                    <GenreRuleGrid
                      items={categoryGenres}
                      selectedAll={selectedGenreAll}
                      selectedAny={selectedGenreAny}
                      selectedExclude={selectedGenreExclude}
                      onSetRule={setGenreRule}
                      showLegend={false}
                    />
                  </div>
                )}
                {demographicGenres.length === 0 && categoryGenres.length === 0 && (
                  <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
                    Sem resultados
                  </div>
                )}
              </div>
            ) : (
              <GenreRuleGrid
                items={filteredGenres}
                selectedAll={selectedGenreAll}
                selectedAny={selectedGenreAny}
                selectedExclude={selectedGenreExclude}
                onSetRule={setGenreRule}
              />
            )}
          </FilterSection>
        </TabsContent>

        <TabsContent value="tags">
          <FilterSection
            title={`Tags${
              selectedTagAll.size + selectedTagAny.size + selectedTagExclude.size
                ? ` (${selectedTagAll.size + selectedTagAny.size + selectedTagExclude.size})`
                : ""
            }`}
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar tag..."
                className="h-9 pl-9 text-sm"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
              />
            </div>
            <GroupedTagRuleGrid
              items={filteredTagChoices}
              allItems={allTagChoices}
              selectedAll={selectedTagAll}
              selectedAny={selectedTagAny}
              selectedExclude={selectedTagExclude}
              onSetRule={setTagRule}
              searchActive={tagSearch.trim().length > 0}
            />
          </FilterSection>
        </TabsContent>
      </Tabs>
      )}

      {!collapsed && (activeFilterChips.length > 0 || filtersDirty) && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterChips.length > 0 && (
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros ativos
              </span>
            )}
            <ActiveFilterChips chips={activeFilterChips} />
            {activeFilterChips.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="h-7 px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                limpar filtros
              </button>
            )}
            {filtersDirty && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
                não aplicados
              </span>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
