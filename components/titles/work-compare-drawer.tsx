"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Ban,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  GripVertical,
  Heart,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Rows3,
  Sparkles,
  Trophy,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GroupCountCell } from "@/components/titles/group-count-cell"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScoreBadge, getCriterionColorClass, criterionCellClass, type ColumnThresholds, type ScoreColorThresholds, type CriterionRange, type AttrColorMode } from "@/components/ui/score-badge"
import { readAttrColorMode, subscribeAttrColorMode } from "@/lib/ui/attr-color-mode"
import { LABELS } from "@/lib/constants/ui-labels"
import {
  PersonalStatusBadge,
  PublicationStatusBadge,
} from "@/components/ui/status-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DecisionBreakdownPanel } from "@/components/titles/decision-breakdown-panel"
import { buildDecisionBreakdown } from "@/lib/calculations/decision-breakdown"
import { moodDimensionLabel } from "@/lib/ui/mood-dimensions"
import { CRITERIA_INFO, PERSONAL_STATUSES_BY_ID, PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { computeMoodAdjusted, isMoodActive, type MoodPracticalDimension, type MoodRefine, type MoodWork } from "@/lib/calculations/mood-refine"
import { TagDensityCell } from "@/components/titles/tag-density-cell"
import { describeWorkTags, formatTagShare } from "@/lib/tags/density"
import type { TagDensity, WorkTagBreakdown } from "@/lib/tags/density"
import type { TagStance, TagStanceInfo } from "@/lib/tags/segment"
import { TagStanceMark, tagStanceTitle } from "@/components/ui/tag-stance-mark"
import { cn } from "@/lib/utils"
import { ScopedTaskStrip, useScopedGuard } from "@/components/tasks/scoped-task"
import { CoverImage } from "@/components/ui/cover-image"
import { QualityHearts } from "@/components/ui/quality-hearts"
import { sortByTitleLanguage } from "@/lib/titles/title-language"
import { fetchCompareWorks, type CompareWork } from "@/server/actions/compare"
import { rerankClusterAction } from "@/server/actions/recommendations"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"
import {
  ColumnPicker,
  type ColumnPickerColumnDef,
  type ColumnPickerConfig,
} from "@/components/ui/column-picker"
import { CompareToolbar } from "@/components/titles/compare-toolbar"

const HIDDEN_ROWS_STORAGE_KEY = "compare_hidden_rows_v1"
// v3 → v4: adiciona as linhas "Prioridade" (decision) e "Alinhamento"
// (personal_fit) ao grupo Notas, posicionadas na ordem canônica.
// v4 → v5: "Votos" sai de dentro da célula da Média externa e vira linha própria.
// O bump é obrigatório: `normalizeRowsConfig` completa chave nova no FIM da ordem
// salva, então sem ele quem já usou o drawer veria "Votos" depois de Gêneros·Tags.
// v5 → v6: "status" vira "status:publicacao" + "status:pessoal", entra "interesse" e
// "ano" passa a nascer oculto (o cabeçalho o imprime).
// 🔴 Sem o bump, quem tinha "status" ESCONDIDO veria as duas linhas novas VISÍVEIS:
// `normalizeRowsConfig` descarta chave desconhecida, então o `hidden` salvo evaporava e
// a escolha da pessoa se invertia em silêncio. O bump zera a personalização — que é
// visível e reversível — em vez de contradizê-la sem avisar.
// v7 → v8: entra "tags-density" (o % de amadas/evitadas). Sem o bump ela cairia no
// FIM da ordem salva — depois da nuvem de chips que ela resume.
const ROWS_CONFIG_STORAGE_KEY = "compare_rows_config_v8"
// Tabela (grid) ⇄ Bússola (plano 2D das 3 forças). Persistido entre aberturas.
const COMPARE_VIEW_STORAGE_KEY = "compare_view_v1"
type CompareView = "table" | "bussola"

interface CompareRowDef {
  key: string
  label: string
}

interface CompareRowGroup {
  id: string
  label: string
  rows: CompareRowDef[]
}

const COMPARE_ROW_GROUPS: CompareRowGroup[] = [
  {
    id: "basico",
    label: "Básico",
    rows: [
      // 🔴 Publicação e Meu status eram UMA linha ("status") com os dois badges lado a lado.
      // São dimensões diferentes — uma fala da obra, a outra de você —, e juntas não davam
      // pra ordenar nem esconder separadamente. Pior: os dois badges numa coluna estreita
      // quebravam linha e esticavam a altura de TODAS as colunas daquela linha do grid.
      { key: "status:publicacao", label: "Publicação" },
      { key: "status:pessoal", label: "Meu status" },
      // Recorrência nos grupos de favoritos. É LINHA e não cabeçalho porque compara as obras
      // entre si — a régua desta tela. Fica junto de "Meu status": as duas falam de você.
      { key: "grupos", label: "Grupos" },
      // O Interesse morava DENTRO do botão de Sinopse no cabeçalho: era a única medida da
      // tela fora de uma linha, logo a única que não dava pra ordenar, esconder nem incluir
      // no "só diferenças".
      { key: "interesse", label: "Interesse" },
      { key: "chapters", label: "Capítulos" },
      { key: "ano", label: "Ano" },
    ],
  },
  {
    id: "notas",
    label: "Notas",
    rows: [
      { key: "score:decision", label: "Prioridade" },
      { key: "score:expectedScore", label: LABELS.expected_score.full },
      { key: "score:personalFit", label: "Alinhamento" },
      { key: "score:alignmentScore", label: "Veredito" },
      { key: "score:platformAvg", label: "Média externa" },
      { key: "score:totalVotes", label: "Votos" },
      { key: "score:userScore", label: "Pessoal" },
    ],
  },
  {
    id: "criterios",
    label: "Critérios",
    rows: CRITERION_SLUGS.map((slug) => ({
      key: `crit:${slug}`,
      label: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    })),
  },
  {
    id: "outros",
    label: "Outros",
    rows: [
      // Quanto das tags da obra é gosto seu, em % — a nuvem de chips embaixo só
      // dá a contagem absoluta, que é 80% explicada por "quão tagueada a obra é"
      // (ver lib/tags/density.ts). É LINHA porque compara as obras entre si.
      { key: "tags-density", label: "Tags no seu gosto" },
      { key: "tags-genres", label: "Gêneros · Tags" },
    ],
  },
]

const ALL_ROW_KEYS = COMPARE_ROW_GROUPS.flatMap((g) => g.rows.map((r) => r.key))

const COMPARE_ROW_GROUP_LABELS: Record<string, string> = Object.fromEntries(
  COMPARE_ROW_GROUPS.map((g) => [g.id, g.label])
)

const COMPARE_ROW_COLUMN_DEFS: ColumnPickerColumnDef[] = COMPARE_ROW_GROUPS.flatMap((g) =>
  g.rows.map((r) => ({ key: r.key, label: r.label, group: g.id }))
)

// Default enxuto: visíveis = Publicação, Meu status, Interesse, Capítulos, Nota Prevista,
// Veredito IA, Média externa, Votos, todos os atributos e Gêneros/Tags.
//
// ⚠️ "ano" nasce ESCONDIDO porque o cabeçalho passou a imprimir o ano ao lado do título —
// mantê-lo aqui seria o mesmo fato dito duas vezes. A linha continua existindo, e não por
// simetria: ela é o único jeito de ORDENAR as colunas por ano (o cabeçalho não ordena).
const DEFAULT_ROWS_CONFIG: ColumnPickerConfig = {
  order: ALL_ROW_KEYS,
  hidden: [
    "ano",
    "score:userScore",
  ],
}

/**
 * Normaliza o config armazenado: descarta chaves desconhecidas, completa
 * rows novas (adicionadas em versões posteriores) no fim mantendo a ordem
 * canônica do grupo.
 */
function normalizeRowsConfig(value: Partial<ColumnPickerConfig> | null | undefined): ColumnPickerConfig {
  const known = new Set(ALL_ROW_KEYS)
  const userOrder = (value?.order ?? []).filter((k) => known.has(k))
  const missing = ALL_ROW_KEYS.filter((k) => !userOrder.includes(k))
  const hidden = (value?.hidden ?? []).filter((k) => known.has(k))
  return { order: [...userOrder, ...missing], hidden }
}

function readRowsConfig(): ColumnPickerConfig {
  if (typeof window === "undefined") return DEFAULT_ROWS_CONFIG
  try {
    const raw = window.localStorage.getItem(ROWS_CONFIG_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ColumnPickerConfig>
      return normalizeRowsConfig(parsed)
    }
    // Migração suave: se tem o storage antigo (só hidden), aproveita.
    const legacy = window.localStorage.getItem(HIDDEN_ROWS_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy)
      if (Array.isArray(parsed)) {
        return normalizeRowsConfig({ order: ALL_ROW_KEYS, hidden: parsed.filter((k): k is string => typeof k === "string") })
      }
    }
    return DEFAULT_ROWS_CONFIG
  } catch {
    return DEFAULT_ROWS_CONFIG
  }
}

function writeRowsConfig(config: ColumnPickerConfig) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ROWS_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore quota / privacy mode errors
  }
}

function readCompareView(): CompareView {
  if (typeof window === "undefined") return "table"
  try {
    return window.localStorage.getItem(COMPARE_VIEW_STORAGE_KEY) === "bussola" ? "bussola" : "table"
  } catch {
    return "table"
  }
}

interface VerdictItem {
  workId: string
  title: string
  slug: string
  coverUrl: string | null
  alignmentScore: number
  justification: string
}

interface WorkCompareDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  onClear: () => void
  onRemoveId: (id: string) => void
  scoreThresholds: ColumnThresholds | null
  /** Quando false, o "Desempatar com IA" mostra upsell em vez de rodar (feature Pago). */
  isPaid?: boolean
  /** Refino por mood (desempate dentro do tier). Quando ativo, mostra a linha
   *  "Prioridade ajustada" + resumo; os `ids` já chegam ordenados pelo mood. */
  moodRefine?: MoodRefine | null
  /**
   * Prioridade ajustada JÁ CALCULADA por quem abriu o drawer. Presente quando o
   * refino veio da LISTA.
   *
   * 🔴 Não é otimização — é correção de régua. `computeMoodFit` normaliza cada
   * dimensão pelo min/max do conjunto que recebe, então recalcular aqui, sobre as
   * poucas obras selecionadas, produz números e ordem diferentes dos que a lista
   * mostrou. Medido em 2026-08-16 no clone local: o mesmo mood sobre a lista de 126
   * favoritas × sobre janelas de 5 obras dá ordem diferente em até 17 de 25 janelas.
   * Herdar é o que mantém as duas telas contando a mesma história.
   */
  moodAdjustedById?: Map<string, number | null> | null
  /** Faixas ideais por critério (perfil). Habilita a cor + melhor/pior "Minha faixa". */
  criterionPrefs?: Record<string, CriterionRange>
}

export function WorkCompareDrawer({
  open,
  onOpenChange,
  ids,
  onClear,
  onRemoveId,
  scoreThresholds,
  isPaid = true,
  moodRefine = null,
  moodAdjustedById = null,
  criterionPrefs,
}: WorkCompareDrawerProps) {
  const colorMode = useSyncExternalStore(subscribeAttrColorMode, readAttrColorMode, () => "catalog" as const)
  const [works, setWorks] = useState<CompareWork[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffOnly, setDiffOnly] = useState(false)
  const [showBestWorst, setShowBestWorst] = useState(true)
  const [reranking, setReranking] = useState(false)
  // Salvar o desempate como run navegável (histórico/URL). LIGADO por padrão desde 2026-08-08
  // (era off, pra não encher o histórico de /recommendations com comparação avulsa): o desempate
  // custa uma execução do limite diário, e perder o resultado dele por um toggle desligado que
  // vivia escondido no topo saía mais caro do que uma linha a mais no histórico.
  const [persistRun, setPersistRun] = useState(true)
  // "Onde diferenciam" é disclosure: fechado por padrão, aberto por clique. Some junto com a
  // tabela quando a Bússola está na tela (lá não há linha nem amplitude que ele explique).
  const [differentialsOpen, setDifferentialsOpen] = useState(false)
  const router = useRouter()
  // Bump pra forçar o re-fetch das obras após o desempate por IA (repovoar a
  // linha "Veredito IA." com os alignment_score recém-computados).
  const [reloadKey, setReloadKey] = useState(0)
  // Veredito do último desempate por IA (popup com 1º/2º/3º + justificativa).
  const [verdict, setVerdict] = useState<VerdictItem[] | null>(null)
  const [rowsConfig, setRowsConfig] = useState<ColumnPickerConfig>(() => readRowsConfig())
  const hiddenRows = useMemo(() => new Set(rowsConfig.hidden), [rowsConfig.hidden])

  // Tabela ⇄ Bússola. Lazy-init do localStorage — o SheetContent só monta ao
  // abrir (client-side), então não há mismatch de hidratação.
  const [compareView, setCompareView] = useState<CompareView>(() => readCompareView())
  const changeCompareView = (v: CompareView) => {
    setCompareView(v)
    try {
      window.localStorage.setItem(COMPARE_VIEW_STORAGE_KEY, v)
    } catch {
      // ignore
    }
  }

  // Obras no formato mínimo da Bússola. Resolve short/cor do status por ID
  // (CompareWork guarda só o publication_status_id) pro tooltip do plano.
  const bussolaData: BussolaDatum[] = useMemo(
    () =>
      works.map((w) => {
        const st = w.publicationStatusId != null ? PUBLICATION_STATUSES_BY_ID[w.publicationStatusId] : null
        return {
          workId: w.id,
          title: w.title,
          coverUrl: w.coverUrl,
          year: w.year,
          isAdult: w.isAdult,
          publicationStatus: st?.status ?? null,
          publicationStatusShort: st?.short ?? null,
          publicationStatusColor: st?.color || null,
          chanceScore: w.chanceScore,
          platformAvg: w.platformAvg,
          totalVotes: w.totalVotes,
          expectedScore: w.expectedScore,
        }
      }),
    [works],
  )
  // A Bússola precisa de ≥2 obras; abaixo disso caímos na tabela.
  const showBussola = compareView === "bussola" && works.length >= 2

  // Critérios que mais separam as obras — alimenta o contador do disclosure no topo e a
  // faixa que ele abre. Mesma função que a faixa usa, pra contador e conteúdo não divergirem.
  const differentials = useMemo(() => getMaxAmplitudeCriteria(works), [works])

  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const parentIdsSortedKey = useMemo(() => [...ids].sort().join(","), [ids])

  // Espelho do `works` atual, lido dentro do effect de fetch sem precisar
  // adicioná-lo às deps (o que causaria loop de re-fetch).
  const worksRef = useRef<CompareWork[]>([])
  useEffect(() => {
    worksRef.current = works
  }, [works])
  // Último reloadKey já materializado por fetch — distingue "rerank pediu
  // reload" de uma simples mudança de ids.
  const appliedReloadKey = useRef(0)
  // Cada abertura do drawer faz um fetch inicial; resetado ao fechar.
  const fetchedForOpenRef = useRef(false)
  useEffect(() => {
    if (!open) fetchedForOpenRef.current = false
  }, [open])

  // Synchronize orderedIds with parent ids while preserving any custom ordering.
  // Sync de estado a partir de props é intencional aqui (mantém a ordem custom
  // do drag em dia quando a tabela pai é reordenada), por isso a supressão.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderedIds((prev) => {
      const filteredPrev = prev.filter((id) => ids.includes(id))
      const newIds = ids.filter((id) => !prev.includes(id))
      return [...filteredPrev, ...newIds]
    })
  }, [ids, open])

  useEffect(() => {
    if (!open || ids.length === 0) return

    // Reconciliação ordem ↔ dados: preserva a ordem custom (drag) e joga ids
    // novos pro fim. Usada tanto no caminho local quanto no de fetch.
    const applyData = (dataById: Map<string, CompareWork>) => {
      setOrderedIds((currentOrder) => {
        const filteredOrder = currentOrder.filter((id) => dataById.has(id))
        const newIds = ids.filter((id) => !currentOrder.includes(id))
        const finalOrder = [...filteredOrder, ...newIds]

        const sortedData = finalOrder
          .map((id) => dataById.get(id))
          .filter((w): w is CompareWork => Boolean(w))

        setWorks(sortedData)
        return finalOrder
      })
    }

    // Remoção/reordenação dentro de uma sessão já carregada: já temos os dados
    // de todos os ids pedidos e não é reload forçado (rerank) nem a primeira
    // carga. Atualiza na hora — sem spinner nem round-trip — pra que o grid e o
    // resumo "Onde diferenciam" reflitam imediatamente os itens exibidos.
    const forcedReload = reloadKey !== appliedReloadKey.current
    const haveAll = ids.every((id) => worksRef.current.some((w) => w.id === id))
    if (fetchedForOpenRef.current && !forcedReload && haveAll) {
      // Só os ids ainda pedidos — `applyData` descarta do finalOrder o que não
      // está no mapa, então isto remove a coluna excluída.
      const idSet = new Set(ids)
      applyData(
        new Map(worksRef.current.filter((w) => idSet.has(w.id)).map((w) => [w.id, w]))
      )
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCompareWorks(ids)
      .then((data) => {
        if (cancelled) return
        fetchedForOpenRef.current = true
        appliedReloadKey.current = reloadKey
        applyData(new Map(data.map((w) => [w.id, w])))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Erro ao carregar"
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentIdsSortedKey, reloadKey])

  // Commita uma ordem de colunas vinda do grid (arrasto). Recebe ids porque a
  // ordem exibida lá pode estar ordenada por uma linha — índice de tela não
  // corresponde a índice deste array.
  const reorderIds = (nextIds: string[]) => {
    const byId = new Map(works.map((w) => [w.id, w]))
    const nextWorks = nextIds
      .map((id) => byId.get(id))
      .filter((w): w is CompareWork => Boolean(w))
    if (nextWorks.length !== works.length) return
    setWorks(nextWorks)
    setOrderedIds(nextIds)
  }

  const updateRowsConfig = (next: ColumnPickerConfig) => {
    const normalized = normalizeRowsConfig(next)
    setRowsConfig(normalized)
    writeRowsConfig(normalized)
  }

  const resetRows = () => updateRowsConfig(DEFAULT_ROWS_CONFIG)

  // Request-scoped, e essa é a parte que engana: o desempate GRAVA um run quando
  // "Salvar" está ligado, mas o entregável é o popup de veredito 1º/2º/3º — que
  // não sobrevive a fechar o drawer. Por isso âmbar, não o indicador azul: dizer
  // "pode navegar" aqui perderia o que a pessoa foi buscar.
  const { guard, guardDialog, elapsed } = useScopedGuard({
    running: reranking,
    title: "Fechar agora perde o desempate",
    what: "Desempatar com IA",
    confirmLabel: "Fechar mesmo assim",
  })

  // Desempate por IA: roda o re-ranker comparando só as obras do drawer
  // cabeça-a-cabeça (rerankClusterAction), depois re-fetcha pra repovoar a linha
  // "Veredito IA." com os scores/justificativas frescos. O destaque "Melhor/pior"
  // marca o vencedor em verde automaticamente.
  const handleRerank = () => {
    if (ids.length < 2 || reranking) return
    setReranking(true)
    rerankClusterAction(ids, { persist: persistRun })
      .then((res) => {
        if (res.error || !res.data) {
          toast.error(res.error ?? "Erro ao desempatar com IA.")
          return
        }
        if (persistRun) {
          if (res.data.savedSlug) {
            const slug = res.data.savedSlug
            toast.success("Desempate salvo no histórico.", {
              action: { label: "Ver", onClick: () => router.push(`/recommendations/${slug}`) },
            })
          } else {
            toast.warning("Desempate rodou, mas a gravação no histórico falhou.")
          }
        }
        // Monta o veredito: ordena (já vem desc) e enriquece com título/capa das
        // obras carregadas (estáveis), pra abrir o popup 1º/2º/3º.
        const worksById = new Map(works.map((w) => [w.id, w]))
        const items: VerdictItem[] = res.data.rankings.map((r) => {
          const w = worksById.get(r.workId)
          return {
            workId: r.workId,
            title: w?.title ?? "Obra",
            slug: w?.slug ?? "",
            coverUrl: w?.coverUrl ?? null,
            alignmentScore: r.alignmentScore,
            justification: r.justification,
          }
        })
        setVerdict(items)
        // Re-fetch em paralelo pra atualizar as linhas Veredito IA. / Prioridade no fundo.
        setReloadKey((k) => k + 1)
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Erro ao desempatar com IA."),
      )
      .finally(() => setReranking(false))
  }

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : guard(() => onOpenChange(false)))}
    >
      {guardDialog}
      <SheetContent
        side="bottom"
        className="h-screen max-h-screen gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Sem `SheetHeader`: ele é só um wrapper de layout (flex-col + padding) e brigava com a
            barra de uma linha. Quem o Radix exige é o `SheetTitle`, que segue aqui dentro. */}
        <CompareToolbar
            title={
              <SheetTitle className="shrink-0 text-base">
                Comparar {loading ? ids.length : works.length} obra
                {(loading ? ids.length : works.length) !== 1 ? "s" : ""}
                {!loading && works.length < ids.length && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({ids.length - works.length} não carregada
                    {ids.length - works.length !== 1 ? "s" : ""})
                  </span>
                )}
              </SheetTitle>
            }
            differentialsCount={loading ? 0 : differentials.length}
            differentialsOpen={differentialsOpen}
            onToggleDifferentials={() => setDifferentialsOpen((v) => !v)}
            view={compareView}
            onViewChange={changeCompareView}
            canSwitchView={works.length >= 2}
            showBussola={showBussola}
            rowsPicker={
              <ColumnPicker
                columns={COMPARE_ROW_COLUMN_DEFS}
                groupLabels={COMPARE_ROW_GROUP_LABELS}
                config={rowsConfig}
                onChange={updateRowsConfig}
                onReset={resetRows}
                triggerLabel="Linhas"
                triggerIcon={<Rows3 className="h-3.5 w-3.5" />}
              />
            }
            diffOnly={diffOnly}
            onDiffOnlyChange={setDiffOnly}
            bestWorst={showBestWorst}
            onBestWorstChange={setShowBestWorst}
            persistRun={persistRun}
            onPersistRunChange={setPersistRun}
            isPaid={isPaid}
            reranking={reranking}
            canRerank={works.length >= 2}
            onRerank={handleRerank}
            onClear={onClear}
            onClose={() => guard(() => onOpenChange(false))}
          />

        {/* O resumo é LEITURA, não controle: colapsado por padrão, e a faixa aberta traz o que
            o chip escondia no `title` — a amplitude e o intervalo min → max de cada critério. */}
        {differentialsOpen && !showBussola && differentials.length > 0 && (
          <div id="compare-differentials" className="border-b px-4 py-3">
            <DifferentialsSummary works={works} />
          </div>
        )}

        <ScopedTaskStrip
          running={reranking}
          elapsed={elapsed}
          label="Desempatando estas obras com IA…"
          note="Fique neste painel. O veredito 1º/2º/3º aparece aqui — fechando agora, você precisa rodar de novo."
          className="mx-4 mt-2"
        />

        {moodRefine && isMoodActive(moodRefine) && <MoodSummaryBanner mood={moodRefine} />}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando comparação…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : works.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhuma obra selecionada.
            </div>
          ) : showBussola ? (
            <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
              <BussolaPlane entries={bussolaData} mode="absolute" thresholds={scoreThresholds?.expected} />
            </div>
          ) : (
            <CompareGrid
              works={works}
              onRemoveId={onRemoveId}
              onReorderIds={reorderIds}
              scoreThresholds={scoreThresholds}
              diffOnly={diffOnly}
              highlightBestWorst={showBestWorst}
              hiddenRows={hiddenRows}
              rowOrder={rowsConfig.order}
              moodRefine={moodRefine}
              inheritedMoodAdjusted={moodAdjustedById}
              colorMode={colorMode}
              criterionPrefs={criterionPrefs}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>

    <VerdictDialog items={verdict} onClose={() => setVerdict(null)} />
    </>
  )
}

/**
 * Popup do "Desempate por IA": ranking 1º/2º/3º das obras comparadas, com o
 * vencedor destacado (🏆) e a justificativa do LLM por obra. Espelha o visual do
 * "Surpreenda-me" (/ranking). Aberto quando `items` não é null.
 */
function VerdictDialog({
  items,
  onClose,
}: {
  items: VerdictItem[] | null
  onClose: () => void
}) {
  const open = items != null && items.length > 0
  const total = items?.length ?? 0
  // Remonta a lista (resetando a contagem visível pro default) a cada novo
  // veredito — a key muda quando o conjunto/ordem das obras muda.
  const verdictKey = (items ?? []).map((i) => i.workId).join(",")
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            Veredito da IA
          </DialogTitle>
          <DialogDescription>
            Comparação cabeça-a-cabeça destas {total} obras. O Veredito IA (0–100)
            ordena o desempate e já entrou na Prioridade de cada uma.
          </DialogDescription>
        </DialogHeader>

        {items && items.length > 0 && <VerdictList key={verdictKey} items={items} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Lista do veredito: por padrão mostra o top 3, com um stepper (− / +) pra
 * ajustar manualmente quantas obras exibir, e um atalho "Ver todas". A área
 * de cards rola sozinha quando excede a altura disponível do diálogo.
 */
function VerdictList({ items }: { items: VerdictItem[] }) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(3, items.length))
  const showControl = items.length > 3
  const shown = items.slice(0, visibleCount)
  const remaining = items.length - visibleCount

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {showControl && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Mostrando top{" "}
            <span className="font-semibold tabular-nums text-foreground">{visibleCount}</span> de{" "}
            {items.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={visibleCount <= 1}
              onClick={() => setVisibleCount((c) => Math.max(1, c - 1))}
              aria-label="Mostrar menos obras"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={visibleCount >= items.length}
              onClick={() => setVisibleCount((c) => Math.min(items.length, c + 1))}
              aria-label="Mostrar mais obras"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {shown.map((item, index) => (
          <VerdictCard key={item.workId} item={item} position={index + 1} />
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setVisibleCount(items.length)}
            className="mt-0.5 rounded-md border border-dashed border-border/70 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Ver todas as {items.length} obras (+{remaining})
          </button>
        )}
      </div>
    </div>
  )
}

function VerdictCard({ item, position }: { item: VerdictItem; position: number }) {
  const medal = position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : null
  const isWinner = position === 1
  const card = (
    <div
      className={cn(
        "group flex gap-3 rounded-lg border bg-card/60 p-3 transition-colors",
        isWinner
          ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-500/5"
          : "hover:border-primary/40 hover:bg-card",
      )}
    >
      <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded border bg-muted">
        {item.coverUrl ? (
          <CoverImage
            url={item.coverUrl}
            alt={item.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
        <span className="absolute left-0.5 top-0.5 text-base leading-none drop-shadow">
          {medal ?? <span className="rounded bg-background/80 px-1 text-[11px] font-bold tabular-nums">{position}º</span>}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
          <span className="text-muted-foreground">{position}º</span>
          <span className="line-clamp-2 group-hover:underline">{item.title}</span>
          {item.slug && (
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </h3>
        <span className="inline-flex w-fit items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
          Veredito {Math.round(item.alignmentScore)}
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">{item.justification}</p>
      </div>
    </div>
  )
  return item.slug ? (
    <Link href={`/catalog/${item.slug}`} target="_blank" rel="noreferrer" className="block">
      {card}
    </Link>
  ) : (
    card
  )
}

/**
 * Identifica os critérios com maior amplitude (max - min) entre as obras
 * comparadas. Útil pra um sumário "O que diferencia" no topo do drawer —
 * o usuário foca direto nos eixos onde as obras de fato divergem.
 */
/**
 * O tooltip do título da coluna: nome completo (que o `line-clamp-2` corta) + os alternativos.
 *
 * ⚠️ `alternativeTitles` já vinha carregado e era descartado. A ordem sai de
 * `sortByTitleLanguage` — o mesmo dono que a página da obra usa —, senão o alternativo legível
 * aparece em posição aleatória entre romanizações e alfabetos não-latinos (são 10.072 títulos
 * no catálogo, 36% fora do alfabeto latino).
 *
 * ⚠️ Corta em 3: o tooltip é `title=` nativo, sem rolagem e sem largura máxima — obra com 20
 * alternativos viraria uma coluna de texto atravessando a tela.
 */
const ALT_TITLES_NO_TOOLTIP = 3

function titleTooltip(work: CompareWork): string {
  const alt = sortByTitleLanguage(
    work.alternativeTitles.filter((t) => t && t !== work.title),
    (t) => t
  )
  const mostrados = alt.slice(0, ALT_TITLES_NO_TOOLTIP)
  const resto = alt.length - mostrados.length
  const linhas = [work.title]
  if (mostrados.length) {
    linhas.push(
      "",
      `Também conhecida como: ${mostrados.join(" · ")}${resto > 0 ? ` (+${resto})` : ""}`
    )
  }
  linhas.push("", "Abre em nova aba")
  return linhas.join("\n")
}

/**
 * O texto da célula de Capítulos — `lidos / total` ou só o total.
 *
 * 🔴 A régua de mostrar progresso vem do BANCO (`personal_status.tracks_progress`), nunca de
 * uma lista de nomes: hoje os quatro sem progresso são Want to Read, Untracked, Not Now e
 * Not Interested, e em todos o "0 /" seria o default de quem nunca abriu a obra — desenhado
 * como fração, lê como leitura ABANDONADA. Status novo no Supabase entra na régua sozinho.
 * Mesma régua da faixa de stats da página da obra.
 *
 * ⚠️ É esta função que o "só diferenças" consulta. Um segundo critério para o mesmo fato foi
 * exatamente o defeito anterior (o filtro comparava o par, a tela mostrava o total).
 */
function chaptersCellText(w: CompareWork): string {
  const total = w.totalChapters ?? null
  const tracks =
    w.personalStatusId != null
      ? (PERSONAL_STATUSES_BY_ID[w.personalStatusId]?.tracksProgress ?? false)
      : false
  if (tracks && w.chaptersRead != null) {
    return `${w.chaptersRead} / ${total ?? "?"}`
  }
  return total != null ? String(total) : "—"
}

function getMaxAmplitudeCriteria(
  works: CompareWork[],
  threshold = 1.5
): Array<{ slug: string; max: number; min: number; amplitude: number }> {
  if (works.length < 2) return []
  const results: Array<{ slug: string; max: number; min: number; amplitude: number }> = []
  const slugs = works[0].criteria.map((c) => c.slug)
  for (const slug of slugs) {
    const values = works
      .map((w) => w.criteria.find((c) => c.slug === slug)?.score)
      .filter((v): v is number => v != null)
    if (values.length < 2) continue
    const max = Math.max(...values)
    const min = Math.min(...values)
    const amplitude = max - min
    if (amplitude >= threshold) results.push({ slug, max, min, amplitude })
  }
  results.sort((a, b) => b.amplitude - a.amplitude)
  return results.slice(0, 3)
}

function getUniqueBestWorst(
  works: CompareWork[],
  getValue: (w: CompareWork) => number | null,
  negative = false
): { bestIndex: number | null; worstIndex: number | null } {
  const values = works.map(getValue)
  const valid = values
    .map((v, i) => ({ value: v, index: i }))
    .filter((item): item is { value: number; index: number } => item.value != null)

  if (valid.length < 2) return { bestIndex: null, worstIndex: null }

  const nums = valid.map((item) => item.value)
  const max = Math.max(...nums)
  const min = Math.min(...nums)

  if (Math.abs(max - min) < 0.0001) {
    return { bestIndex: null, worstIndex: null }
  }

  const maxItems = valid.filter((item) => Math.abs(item.value - max) < 0.0001)
  const minItems = valid.filter((item) => Math.abs(item.value - min) < 0.0001)

  const bestItems = negative ? minItems : maxItems
  const worstItems = negative ? maxItems : minItems

  return {
    bestIndex: bestItems.length === 1 ? bestItems[0].index : null,
    worstIndex: worstItems.length === 1 ? worstItems[0].index : null,
  }
}

interface CompareGridProps {
  works: CompareWork[]
  onRemoveId: (id: string) => void
  /** Commita uma nova ordem de colunas (arrasto). Recebe os ids já na ordem
   *  final — e não índices — porque a ordem exibida pode estar ordenada por
   *  uma linha, caso em que índice de exibição ≠ índice do array do pai. */
  onReorderIds?: (ids: string[]) => void
  scoreThresholds: ColumnThresholds | null
  diffOnly: boolean
  /** Liga/desliga o destaque visual de melhor (verde) / pior (vermelho) por linha. */
  highlightBestWorst: boolean
  hiddenRows: Set<string>
  /** Ordem das linhas escolhida pelo usuário (lista achatada de keys).
   *  Aplicada às seções iteradas (Notas, Critérios). */
  rowOrder: string[]
  /** Refino por mood ativo → mostra a linha "Prioridade ajustada" no topo. */
  moodRefine?: MoodRefine | null
  /** Valores prontos vindos da lista — ver a prop homônima do drawer. */
  inheritedMoodAdjusted?: Map<string, number | null> | null
  /** Modo de cor ativo (catálogo vs. faixa ideal). */
  colorMode: AttrColorMode
  /** Faixas ideais por critério (perfil). */
  criterionPrefs?: Record<string, CriterionRange>
}

// "basico" entrou quando o grupo passou de 3 para 5 linhas (Publicação e Meu status
// separados + Interesse): era a única seção sem cabeçalho, e a que mais cresceu.
type SectionKey = "basico" | "notas" | "criterios" | "tags-generos"

/** Ordenação das COLUNAS (obras) por uma linha do grid. `null` = ordem manual
 *  (arrasto / ordem herdada da página de origem, incl. o refino por mood). */
type ColumnSort = { key: string; dir: "asc" | "desc" }

/** Ciclo do clique no rótulo: maior→menor, menor→maior, manual. Começa em
 *  "desc" porque toda linha ordenável aqui é "quanto maior, mais interessante"
 *  (nota, votos, capítulos, ano) — exceto drama/tragédia, que o usuário inverte
 *  num clique a mais. */
function nextColumnSort(current: ColumnSort | null, key: string): ColumnSort | null {
  if (current?.key !== key) return { key, dir: "desc" }
  if (current.dir === "desc") return { key, dir: "asc" }
  return null
}

/** Ordena as obras por uma linha. Nulo (—) vai SEMPRE pro fim, nas duas
 *  direções: obra sem o dado não é "a menor", é ausente. */
function sortWorksBy(
  works: CompareWork[],
  sort: ColumnSort,
  getValue: (w: CompareWork) => number | null,
): CompareWork[] {
  const mul = sort.dir === "desc" ? -1 : 1
  return [...works].sort((a, b) => {
    const av = getValue(a)
    const bv = getValue(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * mul
  })
}

const NEGATIVE_CRITERIA = new Set<string>(["drama", "tragedy"])

/** Distância de uma nota até a faixa ideal (0 = dentro; >0 = fora). */
function distanceToRange(score: number, range: CriterionRange): number {
  if (score < range.ideal_min) return range.ideal_min - score
  if (score > range.ideal_max) return score - range.ideal_max
  return 0
}

/** Reordena `items` pra refletir a posição da sua key em `order`. Items
 *  cuja key não está em `order` vão pro fim mantendo ordem canônica. */
function sortByOrder<T>(items: T[], getKey: (item: T) => string, order: string[]): T[] {
  const index = new Map(order.map((k, i) => [k, i]))
  return [...items].sort((a, b) => {
    const ai = index.get(getKey(a)) ?? Number.MAX_SAFE_INTEGER
    const bi = index.get(getKey(b)) ?? Number.MAX_SAFE_INTEGER
    return ai - bi
  })
}

function CompareGrid({
  works,
  onRemoveId,
  onReorderIds,
  scoreThresholds,
  diffOnly,
  highlightBestWorst,
  hiddenRows,
  rowOrder,
  moodRefine = null,
  inheritedMoodAdjusted = null,
  colorMode,
  criterionPrefs,
}: CompareGridProps) {
  const n = works.length

  // Segmentação + densidade das tags, UMA vez por obra. A linha "Tags no seu gosto",
  // a nuvem de chips, a ordenação e o "só diferenças" leem deste mesmo objeto — quatro
  // contagens próprias seriam quatro chances de o % discordar dos chips ao lado.
  const tagsById = useMemo(() => {
    const map = new Map<string, WorkTagBreakdown<CompareWork["tags"][number]>>()
    for (const w of works) map.set(w.id, describeWorkTags(w.genres, w.tags, (t) => t.stance ?? null))
    return map
  }, [works])
  const tagsOf = (w: CompareWork) => tagsById.get(w.id) ?? describeWorkTags(w.genres, w.tags, (t) => t.stance ?? null)

  const moodActive = moodRefine != null && isMoodActive(moodRefine)
  // Prioridade ajustada ao mood (0–10) por obra — correção limitada ao MAE.
  //
  // ⚠️ Quando o refino veio da LISTA, os valores chegam prontos e são usados como
  // estão: recalcular aqui mudaria o universo de normalização (ver a prop no
  // WorkCompareDrawerProps). Só o refino aberto pelo divisor de tier calcula aqui,
  // e nesse caso o conjunto do drawer É o cluster que ele normalizou.
  const moodAdjustedById = useMemo(() => {
    if (inheritedMoodAdjusted != null) return inheritedMoodAdjusted
    if (!moodActive || moodRefine == null) return new Map<string, number | null>()
    const moodWorks: MoodWork[] = works.map((w) => ({
      id: w.id,
      decisionScore: w.decisionScore,
      scores: Object.fromEntries(
        w.criteria.map((c) => [c.slug, c.score]),
      ) as Partial<Record<CriterionSlug, number | null>>,
      totalChapters: w.totalChapters,
      personalFit: w.personalFit,
      totalVotes: w.totalVotes,
      synopsisQuality: w.synopsisQuality ?? w.predictedSynopsisQuality,
      artPercentile: w.artPercentile,
      publicationStatusId: w.publicationStatusId,
      platformAvg: w.platformAvg,
      year: w.year,
      personalStatusId: w.personalStatusId,
    }))
    return computeMoodAdjusted(moodWorks, moodRefine, criterionPrefs)
  }, [works, moodActive, moodRefine, criterionPrefs, inheritedMoodAdjusted])
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set())
  const [draggedOverIndex, setDraggedOverIndex] = useState<number | null>(null)
  const [sort, setSort] = useState<ColumnSort | null>(null)

  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const isCollapsed = (key: SectionKey) => collapsed.has(key)



  const allEqualScore = (getter: (w: CompareWork) => number | null): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    const first = values[0]
    return values.every(
      (v) =>
        (v == null && first == null) ||
        (v != null && first != null && Math.abs(v - first) < 0.05)
    )
  }
  const allEqual = <T,>(getter: (w: CompareWork) => T): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    return values.every((v) => v === values[0])
  }

  // Per-row visibility: user hide + diff-only filter
  const isRowVisible = (
    key: string,
    diffEqualFn?: () => boolean
  ): boolean => {
    if (hiddenRows.has(key)) return false
    if (diffOnly && diffEqualFn && diffEqualFn()) return false
    return true
  }

  const pubStatusVisible = isRowVisible("status:publicacao", () =>
    allEqual((w) => w.publicationStatusId)
  )
  const perStatusVisible = isRowVisible("status:pessoal", () =>
    allEqual((w) => w.personalStatusId)
  )
  const interestVisible = isRowVisible("interesse", () => allEqual((w) => w.synopsisQuality))
  // "Só diferenças" compara o que a célula IMPRIME: o número de grupos. Duas obras em dois
  // grupos DIFERENTES imprimem "2" e "2", então somem juntas — igual à correção de Capítulos.
  const gruposVisible = isRowVisible("grupos", () => allEqual((w) => w.groups.length))
  // 🔴 O "só diferenças" tem que comparar EXATAMENTE o que a célula imprime. Isto aqui
  // comparava `lidos/total` enquanto a tela mostrava só o total: duas obras com 45 capítulos
  // e leituras diferentes sobreviviam ao filtro e apareciam como "45" e "45" — o filtro
  // parecendo quebrado. Hoje a célula mostra o mesmo texto que o `allEqual` avalia.
  const chaptersVisible = isRowVisible("chapters", () =>
    allEqual((w) => chaptersCellText(w))
  )
  const yearVisible = isRowVisible("ano", () => allEqual((w) => w.year))

  const notasRowDefs: Array<{
    key: string
    label: string
    get: (w: CompareWork) => number | null
    stub?: (w: CompareWork) => boolean
    formatScore?: (v: number) => string
    thresholds: ScoreColorThresholds | null
    renderExtra?: (w: CompareWork) => React.ReactNode
    wrapScore?: (node: React.ReactNode, w: CompareWork) => React.ReactNode
    /** Renderiza o número no mesmo box dos atributos (h-7 w-12, font-bold) em
     *  vez do ScoreBadge pequeno — pra dar o mesmo destaque visual. */
    asAttributeBox?: boolean
  }> = [
    {
      // Prioridade (0–10) — âncora na Prevista + Veredito IA quando há. Mesmo box
      // colorido dos atributos (escala 0–10).
      key: "score:decision",
      label: "Prioridade",
      get: (w) => w.decisionScore,
      thresholds: scoreThresholds?.expected ?? null,
      asAttributeBox: true,
      // "Por que esta obra está na frente daquela?" não tinha resposta em tela
      // nenhuma — e a ausência produzia a conclusão errada de que a Prioridade
      // ignora Alinhamento, Interesse, nota externa e votos. Ela consome os quatro
      // DENTRO da Prevista, com peso aprendido. Ver lib/calculations/decision-breakdown.ts.
      wrapScore: (node, w) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">
              {node}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <DecisionBreakdownPanel
              breakdown={buildDecisionBreakdown({
                expected: w.expectedScore,
                alignment: w.alignmentScore,
                alignmentConfidence: w.alignmentConfidence,
                alignmentStale: w.alignmentStale,
                verdictScale: w.verdictScale,
                personalFitPercentile: w.personalFitPercentile,
                interestManual: w.synopsisQuality,
                interestPredicted: w.predictedSynopsisQuality,
                platformAvg: w.platformAvg,
                totalVotes: w.totalVotes,
                attributesScored: w.criteria.filter((c) => c.score != null).length,
                attributesTotal: CRITERION_SLUGS.length,
                weightsAuto: w.weightsAuto,
              })}
            />
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: "score:expectedScore",
      label: LABELS.expected_score.full,
      get: (w) => w.expectedScore,
      thresholds: scoreThresholds?.expected ?? null,
      asAttributeBox: true,
    },
    {
      // Alinhamento — percentil na biblioteca (fallback pro cru × 100). Escala
      // 0–100%, então formatScore mostra "%" e thresholds=null (sem ScoreBadge).
      key: "score:personalFit",
      label: "Alinhamento",
      get: (w) => w.personalFitPercentile ?? (w.personalFit != null ? w.personalFit * 100 : null),
      thresholds: null,
      formatScore: (v) => `${Math.round(v)}%`,
    },
    {
      // Veredito IA usa escala 0–100 (diferente dos demais 0–10). thresholds=null
      // pula o ScoreBadge colorido por percentil; formatScore mostra inteiro.
      // wrapScore anexa tooltip com a justificativa do LLM no hover do score
      // (em vez de inline, que ocupava muito espaço vertical).
      key: "score:alignmentScore",
      label: "Veredito",
      get: (w) => w.alignmentScore,
      thresholds: null,
      formatScore: (v) => `${Math.round(v)}/100`,
      wrapScore: (node, w) =>
        w.alignmentJustification ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                {node}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap text-xs leading-relaxed">
              {w.alignmentJustification}
            </TooltipContent>
          </Tooltip>
        ) : node,
    },
    {
      key: "score:userScore",
      label: "Pessoal",
      get: (w) => w.userScore,
      thresholds: null,
    },
    {
      key: "score:platformAvg",
      label: "Média externa",
      get: (w) => w.platformAvg,
      thresholds: null,
      formatScore: (v) => v.toFixed(2),
    },
    {
      // Votos é VOLUME (confiança da média), não nota — por isso linha própria,
      // e não mais um sufixo dentro da célula da Média externa. Zero votos vira
      // null pra cair no "—" e ficar fora do melhor/pior e do "Só diferenças".
      key: "score:totalVotes",
      label: "Votos",
      get: (w) => (w.totalVotes > 0 ? w.totalVotes : null),
      thresholds: null,
      formatScore: (v) => formatVotes(v),
    },
  ]

  const orderedNotasRows = sortByOrder(notasRowDefs, (r) => r.key, rowOrder)
  // A linha "Prioridade ajustada" é efêmera (refino por mood) e fica fixa no topo
  // do grupo Notas — fora do config de ordem/visibilidade do usuário.
  const moodRow: (typeof notasRowDefs)[number] | null = moodActive
    ? {
        key: "score:moodAdjusted",
        label: "Prioridade ajustada",
        get: (w) => moodAdjustedById.get(w.id) ?? null,
        thresholds: scoreThresholds?.expected ?? null,
        asAttributeBox: true,
      }
    : null
  const visibleNotasRows = [
    ...(moodRow ? [moodRow] : []),
    ...orderedNotasRows.filter((r) => isRowVisible(r.key, () => allEqualScore(r.get))),
  ]
  const orderedCritSlugs = sortByOrder([...CRITERION_SLUGS], (slug) => `crit:${slug}`, rowOrder)
  const visibleCritSlugs = orderedCritSlugs.filter((slug) =>
    isRowVisible(`crit:${slug}`, () =>
      allEqualScore((w) => w.criteria.find((c) => c.slug === slug)?.score ?? null)
    )
  )
  // "Só diferenças" compara o que a célula IMPRIME — os dois percentuais já
  // arredondados —, nunca o decimal cru: duas obras exibindo "38%" e "38%"
  // precisam sumir juntas, senão o filtro parece quebrado (mesma correção que
  // Capítulos precisou).
  const tagsDensityVisible = isRowVisible("tags-density", () =>
    allEqual((w) => {
      const d = tagsOf(w).density
      return `${formatTagShare(d.lovedPct)}|${formatTagShare(d.avoidedPct)}`
    })
  )
  const tagsGenresVisible = isRowVisible("tags-genres")
  const showTagsSection = tagsDensityVisible || tagsGenresVisible

  const showBasicoSection =
    pubStatusVisible || perStatusVisible || gruposVisible || interestVisible || chaptersVisible || yearVisible
  const showNotasSection = visibleNotasRows.length > 0
  const showCriteriosSection = visibleCritSlugs.length > 0

  // Linhas ordenáveis: só as de grandeza comparável. Status e Gêneros·Tags
  // ficam de fora (não são escala), e por isso o rótulo delas não ganha a
  // affordance de clique. Usa TODAS as linhas de Notas — não só as visíveis —
  // pra que esconder a linha ordenada não desfaça a ordem em silêncio.
  const sortableRows: Array<{
    key: string
    label: string
    get: (w: CompareWork) => number | null
  }> = [
    { key: "chapters", label: "Capítulos", get: (w: CompareWork) => w.totalChapters },
    { key: "ano", label: "Ano", get: (w: CompareWork) => w.year },
    // Ordena pelo % de AMADAS. As evitadas não ganham ordenação própria: são
    // mediana 1,7% e zero em 44% das obras — uma segunda linha ficaria vazia
    // no caso comum (ver a variante C do mockup, recusada por isso).
    { key: "tags-density", label: "Tags no seu gosto", get: (w: CompareWork) => tagsOf(w).density.lovedPct },
    ...(moodRow ? [moodRow] : []),
    ...orderedNotasRows,
    ...CRITERION_SLUGS.map((slug) => ({
      key: `crit:${slug}`,
      label: CRITERIA_INFO[slug]?.name ?? slug,
      get: (w: CompareWork) => w.criteria.find((c) => c.slug === slug)?.score ?? null,
    })),
  ].map((r) => ({ key: r.key, label: r.label, get: r.get }))

  // Sort só vale enquanto a linha existir (o mood some → a "Prioridade
  // ajustada" some com ele); caso contrário volta pro manual sem chip órfão.
  const activeRow = sort ? sortableRows.find((r) => r.key === sort.key) ?? null : null
  // Ordem EXIBIDA. Toda a renderização abaixo usa `displayed` — inclusive o
  // melhor/pior, cujo índice é posicional e precisa casar com as colunas.
  const displayed = sort && activeRow ? sortWorksBy(works, sort, activeRow.get) : works

  const sortControl = (key: string) =>
    sortableRows.some((r) => r.key === key)
      ? {
          dir: activeRow?.key === key ? sort!.dir : null,
          onToggle: () => setSort((cur) => nextColumnSort(cur, key)),
        }
      : undefined

  // Arrasto commita a ordem EXIBIDA (já com a movida aplicada) e desliga a
  // ordenação: com sort ativo, o índice da coluna na tela não é o índice no
  // array do pai — mandar ids resolve os dois de uma vez.
  const handleDrop = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const next = [...displayed]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setSort(null)
    onReorderIds?.(next.map((w) => w.id))
  }

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `120px repeat(${n}, minmax(180px, 240px))`,
  }

  return (
    <TooltipProvider delayDuration={150}>
      {/* O sumário "Onde elas se diferenciam" foi movido pra barra superior
          (renderizado no WorkCompareDrawer, abaixo do header). */}
      {activeRow && sort && (
        <div className="mx-auto flex w-fit items-center gap-2 px-4 pt-3 text-xs sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-primary">
            {sort.dir === "desc" ? (
              <ArrowDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
            <span className="font-medium">Ordenado por {activeRow.label}</span>
            <span className="text-primary/70">
              {sort.dir === "desc" ? "maior primeiro" : "menor primeiro"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setSort(null)}
            className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            Ordem manual
          </button>
        </div>
      )}
      <div
        className="mx-auto grid w-fit gap-x-2 px-4 py-4 text-sm sm:px-6"
        style={gridStyle}
      >
        {/* Header */}
        <div className="sticky left-0 top-0 z-30 bg-background/95 backdrop-blur-md" />
        {displayed.map((w, index) => (
          <div
            key={w.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(index))
              e.dataTransfer.effectAllowed = "move"
            }}
            onDragOver={(e) => {
              e.preventDefault()
            }}
            onDragEnter={() => {
              setDraggedOverIndex(index)
            }}
            onDragEnd={() => {
              setDraggedOverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const fromIndex = Number(e.dataTransfer.getData("text/plain"))
              if (!isNaN(fromIndex)) {
                handleDrop(fromIndex, index)
              }
              setDraggedOverIndex(null)
            }}
            className={cn(
              "sticky top-0 z-20 transition-all duration-200",
              draggedOverIndex === index && "ring-2 ring-dashed ring-primary ring-offset-2 rounded-lg scale-[0.98] opacity-70"
            )}
          >
            <CompareHeaderCell
              work={w}
              onRemove={() => onRemoveId(w.id)}
            />
          </div>
        ))}

        {/* Básico — ganhou cabeçalho quando virou 5 linhas. ⚠️ A condição é "existe ALGUMA
            linha visível": um título de seção sobre nada é pior que título nenhum, e o
            seletor de Linhas pode esconder as cinco. */}
        {showBasicoSection && (
          <SectionTitle
            label="Básico"
            collapsed={isCollapsed("basico")}
            onToggle={() => toggleSection("basico")}
          />
        )}

        {/* Publicação — o estado da OBRA */}
        {showBasicoSection && !isCollapsed("basico") && pubStatusVisible && (
          <>
            <SectionLabel label="Publicação" />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <PublicationStatusBadge statusId={w.publicationStatusId ?? undefined} hiatusKind={w.hiatusKind} hiatusKindConfidence={w.hiatusKindConfidence} publicationStatusNote={w.publicationStatusNote} />
              </CompareCell>
            ))}
          </>
        )}

        {/* Meu status — o SEU estado com a obra */}
        {showBasicoSection && !isCollapsed("basico") && perStatusVisible && (
          <>
            <SectionLabel label="Meu status" />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <PersonalStatusBadge statusId={w.personalStatusId ?? undefined} />
              </CompareCell>
            ))}
          </>
        )}

        {/* Grupos — em quantos dos seus recortes a obra aparece */}
        {showBasicoSection && !isCollapsed("basico") && gruposVisible && (
          <>
            <SectionLabel label="Grupos" />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <GroupCountCell groups={w.groups} />
              </CompareCell>
            ))}
          </>
        )}

        {/* Interesse — a sua nota à sinopse (era um ♥ solto dentro do botão de Sinopse) */}
        {showBasicoSection && !isCollapsed("basico") && interestVisible && (
          <>
            <SectionLabel label="Interesse" />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                {/* ⚠️ `QualityHearts` é o dono do desenho (glifo, tom manual × previsão, escala
                    de 4) — a 1ª versão desta célula imprimia a string crua com um rosa escrito
                    à mão, que é uma 2ª régua para a mesma coisa. `showEmpty` é o que dá a
                    escala (♥♥♥ + ♡): numa comparação lado a lado, "3 de 4" só se lê se o teto
                    estiver na tela. */}
                {w.synopsisQuality ? (
                  <QualityHearts
                    quality={w.synopsisQuality}
                    variant="manual"
                    showEmpty
                    className="text-[15px]"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </CompareCell>
            ))}
          </>
        )}

        {/* Capítulos */}
        {showBasicoSection && !isCollapsed("basico") && chaptersVisible && (
          <>
            <SectionLabel label="Capítulos" sort={sortControl("chapters")} />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <span className="text-sm tabular-nums">{chaptersCellText(w)}</span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Ano — fora do padrão (o cabeçalho o imprime); segue no seletor de Linhas porque
            é o único jeito de ORDENAR as colunas por ano. */}
        {showBasicoSection && !isCollapsed("basico") && yearVisible && (
          <>
            <SectionLabel label="Ano" sort={sortControl("ano")} />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <span className="text-sm tabular-nums text-muted-foreground">
                  {w.year ?? "—"}
                </span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Notas */}
        {showNotasSection && (
          <SectionTitle
            label="Notas"
            collapsed={isCollapsed("notas")}
            onToggle={() => toggleSection("notas")}
          />
        )}
         {showNotasSection && !isCollapsed("notas") &&
          visibleNotasRows.map((row) => {
            const { bestIndex, worstIndex } = highlightBestWorst
              ? getUniqueBestWorst(displayed, row.get)
              : { bestIndex: null, worstIndex: null }
            return (
              <ScoreRow
                key={row.key}
                label={row.label}
                works={displayed}
                getScore={row.get}
                sort={sortControl(row.key)}
                bestIndex={bestIndex}
                worstIndex={worstIndex}
                thresholds={row.thresholds}
                formatScore={row.formatScore}
                getStub={row.stub}
                renderExtra={row.renderExtra}
                wrapScore={row.wrapScore}
                asAttributeBox={row.asAttributeBox}
              />
            )
          })}

        {/* Critérios */}
        {showCriteriosSection && (
          <SectionTitle
            label="Critérios"
            collapsed={isCollapsed("criterios")}
            onToggle={() => toggleSection("criterios")}
          />
        )}
        {showCriteriosSection && !isCollapsed("criterios") &&
          visibleCritSlugs.map((slug) => {
            const info = CRITERIA_INFO[slug]
            const isNegative = slug === "drama" || slug === "tragedy"
            // Faixa ideal ativa pra este critério (peso ≥ ínfimo) → melhor = mais
            // perto da faixa (métrica = -distância, maior = melhor; sem inversão).
            const range =
              colorMode === "range" ? criterionPrefs?.[slug] ?? null : null
            const useRange = range != null && range.weight >= 0.05
            const { bestIndex, worstIndex } = highlightBestWorst
              ? getUniqueBestWorst(
                  displayed,
                  (w) => {
                    const s = w.criteria.find((c) => c.slug === slug)?.score ?? null
                    if (s == null) return null
                    return useRange ? -distanceToRange(s, range!) : s
                  },
                  useRange ? false : isNegative
                )
              : { bestIndex: null, worstIndex: null }
            return (
              <CriterionRow
                key={slug}
                slug={slug}
                label={info.name}
                emoji={info.emoji}
                works={displayed}
                sort={sortControl(`crit:${slug}`)}
                bestIndex={bestIndex}
                worstIndex={worstIndex}
                thresholds={scoreThresholds?.criteria?.[slug] ?? null}
                colorMode={colorMode}
                range={range}
              />
            )
          })}

        {/* Gêneros · Tags — duas linhas: o resumo em % e a nuvem que ele resume */}
        {showTagsSection && (
          <SectionTitle
            label="Gêneros · Tags"
            collapsed={isCollapsed("tags-generos")}
            onToggle={() => toggleSection("tags-generos")}
          />
        )}
        {showTagsSection && !isCollapsed("tags-generos") && tagsDensityVisible && (
          <>
            <SectionLabel label="Tags no seu gosto" sort={sortControl("tags-density")} />
            {displayed.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <TagDensityCell density={tagsOf(w).density} />
              </CompareCell>
            ))}
          </>
        )}
        {showTagsSection && !isCollapsed("tags-generos") && tagsGenresVisible && (
          <>
            <SectionLabel label="" />
            {displayed.map((w) => (
              <CompareCell key={w.id} verticalAlign="top" horizontalAlign="left">
                <GenresTagsCell genres={w.genres} breakdown={tagsOf(w)} />
              </CompareCell>
            ))}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

/**
 * A faixa que o disclosure "Onde diferenciam" abre. Sem título próprio: quem nomeia é o botão
 * do topo — repetir ali gastaria a primeira linha da faixa dizendo o que a pessoa acabou de
 * clicar. A variante `compact` (chips soltos no header) morreu junto com o header antigo.
 */
function DifferentialsSummary({ works }: { works: CompareWork[] }) {
  const diffs = getMaxAmplitudeCriteria(works)
  if (diffs.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-300/40 bg-amber-50/40 p-3 dark:bg-amber-500/5">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Critérios com pelo menos 1.5 ponto de diferença entre a maior e a menor nota destas obras.
      </p>
      <div className="flex flex-wrap gap-2">
        {diffs.map((d) => {
          const info = CRITERIA_INFO[d.slug]
          return (
            <div
              key={d.slug}
              className="flex flex-col gap-0.5 rounded-md border border-amber-300/40 bg-background/60 px-2.5 py-1.5 text-xs"
              title={info?.description ?? undefined}
            >
              <div className="flex items-center gap-1.5">
                <span>{info?.emoji}</span>
                <span className="font-medium">{info?.name ?? d.slug}</span>
                <span className="ml-1 rounded-sm bg-amber-200/60 px-1 font-mono text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  diferença {d.amplitude.toFixed(1)}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                menor {d.min.toFixed(1)}
                <span className="mx-1.5 opacity-60">→</span>
                maior {d.max.toFixed(1)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompareHeaderCell({
  work,
  onRemove,
}: {
  work: CompareWork
  onRemove: () => void
}) {
  return (
    <div className="relative flex flex-col rounded-lg border border-border/80 bg-card/95 p-2.5 shadow-sm backdrop-blur-md transition-all hover:bg-card">
      {/* Capa + (título · ações · 18+/ano · sinopse).
          Não há mais faixa "Mover" no topo: ela custava ~26px por coluna para rotular um
          gesto cujo alvo real é o card inteiro (o wrapper do grid é que tem `draggable`).
          O ⠿ ficou como affordance, agora na linha do título. */}
      <div className="flex gap-2.5">
        <div className="relative h-24 w-[4.25rem] shrink-0 overflow-hidden rounded-md border bg-muted/40">
          {work.coverUrl ? (
            <CoverImage
              url={work.coverUrl}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-5 w-5 opacity-40" />
            </div>
          )}
          {/* `isFavorite` já vinha carregado e não era exibido em lugar nenhum. */}
          {work.isFavorite && (
            <span
              className="absolute right-1 top-1 text-[11px] leading-none text-rose-400 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]"
              title="Nos seus favoritos"
              aria-label="Nos seus favoritos"
            >
              ♥
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-1">
            {/* 🔴 A altura de 2 linhas é RESERVADA (`min-h`), não consequência do texto.
                Antes o bloco usava `justify-between`: com título de 1 linha sobrava um vão
                de 24px entre o nome e a Sinopse, com 2 linhas sobravam 8px — medido, e as
                colunas vizinhas nunca casavam. */}
            <Link
              href={`/catalog/${work.slug}`}
              target="_blank"
              rel="noreferrer"
              title={titleTooltip(work)}
              className="block min-h-[2.25rem] min-w-0 flex-1 text-xs font-semibold leading-snug text-foreground hover:text-primary hover:underline"
            >
              <span className="line-clamp-2">{work.title}</span>
            </Link>
            {/* O ↗ saiu: o título já é um link `target="_blank"` — o ícone repetia a mesma
                ação ocupando 22px de uma linha disputada. */}
            <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              <span
                className="flex size-5 cursor-grab items-center justify-center rounded active:cursor-grabbing hover:bg-muted hover:text-foreground"
                title="Arraste o card para reordenar"
                aria-hidden
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <button
                type="button"
                onClick={onRemove}
                aria-label="Tirar da comparação"
                title="Tirar da comparação"
                className="flex size-5 items-center justify-center rounded transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Identidade da obra, não comparação: responde "que obra é essa?" a um palmo do
              título. É este bloco que ocupa o vão que antes ficava vazio. */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            {work.isAdult && (
              <span
                className="rounded border border-red-500/45 bg-red-500/10 px-1 py-px text-[10px] font-bold leading-none text-red-600 dark:text-red-300"
                title="Conteúdo 18+"
              >
                18+
              </span>
            )}
            <span className="tabular-nums text-muted-foreground">{work.year ?? "—"}</span>
          </div>
          <SynopsisButton synopsis={work.synopsis} />
        </div>
      </div>
    </div>
  )
}

/**
 * Só a AÇÃO de ler a sinopse. O Interesse (♥♥♥) morava aqui dentro e virou linha própria —
 * medida não mora em botão: era o único número da tela que não dava pra ordenar nem esconder.
 *
 * ⚠️ As cores fixas do antigo selo (`text-rose-600` no gatilho, `bg-rose-50 text-rose-700` no
 * popover) saíram junto: eram claras SEM variante escura, então no tema escuro o ♥ ficava
 * vermelho sobre fundo escuro e o popover abria um bloco quase branco.
 */
function SynopsisButton({ synopsis }: { synopsis: string | null }) {
  if (!synopsis) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="mt-auto inline-flex h-6 w-full cursor-not-allowed items-center justify-center gap-1 rounded-md border border-dashed bg-background/40 px-2 text-[11px] text-muted-foreground/60"
            aria-disabled="true"
          >
            <BookOpen className="h-3 w-3" />
            Sinopse
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Sem sinopse
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-auto inline-flex h-6 w-full items-center justify-center gap-1 rounded-md border bg-background/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background hover:text-foreground"
        >
          <BookOpen className="h-3 w-3" />
          Sinopse
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        portalled={false}
        className="max-w-sm p-3 text-sm"
      >
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
          {synopsis}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** Cor do chip conforme a stance (amada=verde, evitada=vermelho). */
const STANCE_BADGE_CLASS: Record<TagStance, string> = {
  love: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  avoid: "border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

/**
 * Chip de tag com stance. O ♥/⊘ marca a ênfase 2× — sem ele a prévia de 5 chips
 * mostra a tag mais decisiva da obra com exatamente o mesmo peso de uma amada
 * qualquer, que é o que a ordenação do `segmentTags` acabou de resolver.
 */
function StanceChip({
  tag,
  stance,
}: {
  tag: { slug: string; name: string }
  stance: TagStanceInfo | null | undefined
}) {
  return (
    <Badge
      variant="outline"
      title={stance ? tagStanceTitle(stance) : undefined}
      className={cn(
        "h-5 gap-1 py-0 text-[11px] font-normal",
        stance ? STANCE_BADGE_CLASS[stance.stance] : undefined,
        stance?.strong && "font-medium",
      )}
    >
      {stance?.strong && <TagStanceMark stance={stance.stance} />}
      {tag.name}
    </Badge>
  )
}

function GenresTagsCell({
  genres,
  breakdown,
}: {
  genres: string[]
  /** Segmentação + densidade prontas — a MESMA que a linha de cima imprime em %. */
  breakdown: WorkTagBreakdown<{ slug: string; name: string; groupId: string | null; groupName: string | null; subGroupName?: string | null; stance?: TagStanceInfo | null }>
}) {
  const { loved, avoided, rest, density } = breakdown
  const total = genres.length + density.total
  if (total === 0) {
    return <span className="text-xs italic text-muted-foreground">—</span>
  }

  // Preview inline: gêneros, depois amadas › evitadas › resto (ordem de prioridade).
  const orderedTags = [...loved, ...avoided, ...rest]
  const VISIBLE = 5
  const visibleGenres = genres.slice(0, VISIBLE)
  const remainingForTags = Math.max(0, VISIBLE - visibleGenres.length)
  const visibleTags = orderedTags.slice(0, remainingForTags)
  const remaining = total - visibleGenres.length - visibleTags.length

  // Resto agrupado por grupo → sub-grupo (mesma lógica de antes, só sobre o resto).
  const groupedRest = (() => {
    const groups = new Map<string, typeof rest>()
    for (const tag of rest) {
      const label = tag.groupName ?? "Sem grupo"
      const list = groups.get(label) ?? []
      list.push(tag)
      groups.set(label, list)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "Sem grupo") return 1
      if (b === "Sem grupo") return -1
      return a.localeCompare(b)
    })
  })()

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleGenres.map((g) => (
        <Badge
          key={`g:${g}`}
          variant="secondary"
          className="h-5 py-0 text-[11px] font-normal"
        >
          {g}
        </Badge>
      ))}
      {visibleTags.map((t) => (
        <StanceChip key={`t:${t.slug}`} tag={t} stance={t.stance} />
      ))}
      {remaining > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 items-center rounded-full border border-dashed border-border/70 bg-background/40 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              +{remaining} ver
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            portalled={false}
            className="max-h-[60vh] w-80 max-w-[90vw] space-y-3 overflow-y-auto p-3"
          >
            {genres.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Gêneros{" "}
                  <span className="text-muted-foreground/60">({genres.length})</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {genres.map((g) => (
                    <Badge
                      key={`g:${g}`}
                      variant="secondary"
                      className="h-5 py-0 text-[11px] font-normal"
                    >
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {loved.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <Heart className="h-2.5 w-2.5" /> Amadas{" "}
                  <span className="text-emerald-600/60 dark:text-emerald-400/60">
                    ({loved.length} · {formatTagShare(density.lovedPct)} das tags)
                  </span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {loved.map((t) => (
                    <StanceChip key={`t:${t.slug}`} tag={t} stance={t.stance} />
                  ))}
                </div>
              </div>
            )}
            {avoided.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  <Ban className="h-2.5 w-2.5" /> Evitadas{" "}
                  <span className="text-rose-600/60 dark:text-rose-400/60">
                    ({avoided.length} · {formatTagShare(density.avoidedPct)})
                  </span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {avoided.map((t) => (
                    <StanceChip key={`t:${t.slug}`} tag={t} stance={t.stance} />
                  ))}
                </div>
              </div>
            )}
            {groupedRest.map(([groupName, groupTags]) => {
              // Split into collapsible sub-group sections when the group has any.
              const subSections = groupTags.some((t) => t.subGroupName)
                ? (() => {
                    const bySub = new Map<string, typeof groupTags>()
                    const ungrouped: typeof groupTags = []
                    for (const t of groupTags) {
                      if (t.subGroupName) {
                        const arr = bySub.get(t.subGroupName) ?? []
                        arr.push(t)
                        bySub.set(t.subGroupName, arr)
                      } else ungrouped.push(t)
                    }
                    const out = [...bySub.entries()]
                      .map(([name, tgs]) => ({ name, tags: tgs }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                    if (ungrouped.length) out.push({ name: "Outras", tags: ungrouped })
                    return out
                  })()
                : null
              return (
                <div key={groupName}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupName}{" "}
                    <span className="text-muted-foreground/60">({groupTags.length})</span>
                  </p>
                  {subSections ? (
                    <div className="space-y-1">
                      {subSections.map((sg) => (
                        <details key={sg.name} className="group">
                          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground">
                            <ChevronDown className="h-2.5 w-2.5 transition-transform group-open:rotate-180" />
                            {sg.name}{" "}
                            <span className="text-muted-foreground/60">({sg.tags.length})</span>
                          </summary>
                          <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
                            {sg.tags.map((t) => (
                              <Badge key={`t:${t.slug}`} variant="outline" className="h-5 py-0 text-[11px] font-normal">
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {groupTags.map((t) => (
                        <Badge
                          key={`t:${t.slug}`}
                          variant="outline"
                          className="h-5 py-0 text-[11px] font-normal"
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

/** Controle de ordenação anexado ao rótulo de uma linha. `dir` = direção ativa
 *  desta linha (null quando a ordenação é de outra linha ou está manual). */
interface RowSortControl {
  dir: "asc" | "desc" | null
  onToggle: () => void
}

function SectionLabel({
  label,
  emoji,
  sort,
  textClassName = "font-medium",
}: {
  label: string
  emoji?: string
  sort?: RowSortControl
  textClassName?: string
}) {
  const content = (
    <>
      {emoji && (
        <span aria-hidden className="text-base">
          {emoji}
        </span>
      )}
      <span className={textClassName}>{label}</span>
    </>
  )
  const base = "sticky left-0 z-10 flex items-center gap-1.5 bg-background text-xs text-muted-foreground"

  if (!sort) return <div className={base}>{content}</div>

  // Seta só aparece no hover enquanto a linha não é a ordenada — a affordance
  // existe sem poluir 20 rótulos com ícone permanente.
  const Icon = sort.dir === "desc" ? ArrowDown : sort.dir === "asc" ? ArrowUp : ChevronsUpDown
  return (
    <button
      type="button"
      onClick={sort.onToggle}
      title={
        sort.dir === "desc"
          ? `Ordenado por ${label}, maior primeiro — clique para inverter`
          : sort.dir === "asc"
            ? `Ordenado por ${label}, menor primeiro — clique para voltar à ordem manual`
            : `Ordenar as obras por ${label}`
      }
      className={cn(base, "group text-left transition-colors hover:text-foreground", sort.dir && "text-foreground")}
    >
      {content}
      <Icon
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          sort.dir ? "text-primary opacity-100" : "opacity-0 group-hover:opacity-60",
        )}
      />
    </button>
  )
}

function SectionTitle({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="col-span-full mt-4 mb-1 border-t bg-background pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky left-0 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <span>{label}</span>
      </button>
    </div>
  )
}

interface CompareCellProps {
  children: React.ReactNode
  highlightVariant?: "best" | "worst"
  verticalAlign?: "center" | "top"
  horizontalAlign?: "center" | "left"
}

/**
 * ⚠️ O padrão é CENTRALIZADO. Cada linha é uma medida lida na horizontal, e alinhamento
 * misto (badge à esquerda, número no meio) faz o olho reancorar a cada linha. Quem precisa
 * de `left` pede explicitamente — hoje só a nuvem de Gêneros·Tags, onde o conteúdo é texto
 * corrido em muitos chips e a borda esquerda é o que dá o que ler.
 */
function CompareCell({
  children,
  highlightVariant,
  verticalAlign = "center",
  horizontalAlign = "center",
}: CompareCellProps) {
  return (
    <div
      className={cn(
        "flex min-h-[2.25rem] rounded-md border bg-card/30 px-2.5 py-1.5 transition-all duration-200 hover:bg-card/50",
        verticalAlign === "top" ? "items-start" : "items-center",
        horizontalAlign === "center" ? "justify-center" : "justify-start",
        !highlightVariant && "border-border/30",
        highlightVariant === "best" && "!bg-emerald-500/5 dark:!bg-emerald-500/10 !border-emerald-500/30 dark:!border-emerald-400/40 shadow-sm",
        highlightVariant === "worst" && "!bg-rose-500/5 dark:!bg-rose-500/10 !border-rose-500/25 dark:!border-rose-400/30 shadow-sm"
      )}
    >
      {children}
    </div>
  )
}

interface ScoreRowProps {
  label: string
  works: CompareWork[]
  getScore: (w: CompareWork) => number | null
  bestIndex: number | null
  worstIndex: number | null
  thresholds: ScoreColorThresholds | null
  formatScore?: (v: number) => string
  getStub?: (w: CompareWork) => boolean
  renderExtra?: (w: CompareWork) => React.ReactNode
  /** Quando definido, envolve o elemento do score com este wrapper — útil
   *  pra anexar tooltip/popover (ex.: justificativa do Veredito IA no hover). */
  wrapScore?: (node: React.ReactNode, w: CompareWork) => React.ReactNode
  /** Renderiza o número no mesmo box dos atributos (CriterionRow) em vez do
   *  ScoreBadge pequeno — usado por Prioridade / Nota Prevista. */
  asAttributeBox?: boolean
  /** Ordenação das colunas por esta linha (clique no rótulo). */
  sort?: RowSortControl
}

function ScoreRow({
  label,
  works,
  getScore,
  bestIndex,
  worstIndex,
  thresholds,
  formatScore,
  getStub,
  renderExtra,
  wrapScore,
  asAttributeBox,
  sort,
}: ScoreRowProps) {
  return (
    <>
      <SectionLabel label={label} sort={sort} />
      {works.map((w, index) => {
        const score = getScore(w)
        const variant =
          index === bestIndex ? "best" : index === worstIndex ? "worst" : undefined
        const baseScoreNode = formatScore && score != null ? (
          <span className="font-mono text-sm font-semibold">
            {formatScore(score)}
          </span>
        ) : asAttributeBox ? (
          // Mesmo box dos atributos (CriterionRow): escala 0–10 positiva, então
          // passa um slug não-negativo pro getCriterionColorClass.
          score == null ? (
            <span className="font-mono text-sm text-muted-foreground">—</span>
          ) : (
            <span
              className={cn(
                "grid h-7 w-12 place-items-center rounded-md font-mono text-sm font-bold",
                getCriterionColorClass(score, "decision", thresholds)
              )}
            >
              {score.toFixed(1)}
            </span>
          )
        ) : (
          <ScoreBadge
            score={score}
            size="sm"
            thresholds={thresholds}
            showStub={getStub?.(w) ?? false}
          />
        )
        const scoreNode = wrapScore ? wrapScore(baseScoreNode, w) : baseScoreNode
        return (
          <CompareCell key={w.id} highlightVariant={variant} horizontalAlign="center">
            <div className="flex items-baseline gap-2">
              {scoreNode}
              {renderExtra?.(w)}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
}

interface CriterionRowProps {
  slug: string
  label: string
  emoji: string
  works: CompareWork[]
  bestIndex: number | null
  worstIndex: number | null
  thresholds: ScoreColorThresholds | null
  colorMode: AttrColorMode
  range: CriterionRange | null
  /** Ordenação das colunas por este critério (clique no rótulo). */
  sort?: RowSortControl
}

function CriterionRow({ slug, label, emoji, works, bestIndex, worstIndex, thresholds, colorMode, range, sort }: CriterionRowProps) {
  return (
    <>
      <SectionLabel label={label} emoji={emoji} sort={sort} textClassName="truncate" />
      {works.map((w, index) => {
        const entry = w.criteria.find((c) => c.slug === slug)
        const score = entry?.score ?? null
        const justification = entry?.aiJustification ?? null
        const variant =
          index === bestIndex ? "best" : index === worstIndex ? "worst" : undefined
        return (
          <CompareCell key={w.id} highlightVariant={variant} horizontalAlign="center">
            <div className="flex items-center gap-2">
              {score == null ? (
                <span className="font-mono text-sm text-muted-foreground">—</span>
              ) : (
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-md font-mono text-sm font-bold",
                    criterionCellClass({ score, slug, mode: colorMode, thresholds, range })
                  )}
                >
                  {score.toFixed(1)}
                </span>
              )}
              {justification && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Ver justificativa da IA"
                      className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs text-xs leading-relaxed"
                  >
                    {justification}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
}



function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

/** Resumo do refino por mood ativo, acima do grid. */
function MoodSummaryBanner({ mood }: { mood: MoodRefine }) {
  const prioritize: string[] = []
  const avoid: string[] = []
  for (const [slug, w] of Object.entries(mood.attributes) as Array<[CriterionSlug, number]>) {
    const info = CRITERIA_INFO[slug]
    const strong = Math.abs(w) >= 2 ? "++" : ""
    const chip = `${info.emoji} ${info.name}${strong}`
    if (w > 0) prioritize.push(chip)
    else avoid.push(chip)
  }
  if (mood.chapters === "curto") prioritize.push("📖 Mais curto")
  if (mood.chapters === "longo") prioritize.push("📖 Mais longo")
  // Os rótulos das práticas saem de `moodDimensionLabel`, nunca escritos aqui: o
  // diálogo e este resumo falam da MESMA escolha, e duas cópias divergiriam no
  // primeiro ajuste de texto.
  for (const [key, w] of Object.entries(mood.practical ?? {}) as Array<
    [MoodPracticalDimension, number]
  >) {
    const chip = moodDimensionLabel(key, w)
    if (w > 0) prioritize.push(chip)
    else avoid.push(chip)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/5 px-4 py-2 text-xs">
      <span className="font-semibold text-primary">Refinado por mood:</span>
      {prioritize.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Priorizando</span>
          {prioritize.map((c) => (
            <span key={c} className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{c}</span>
          ))}
        </span>
      )}
      {avoid.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Evitando</span>
          {avoid.map((c) => (
            <span key={c} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600 dark:text-rose-300">{c}</span>
          ))}
        </span>
      )}
    </div>
  )
}
