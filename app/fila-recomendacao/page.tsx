import { Clock, Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { MODEL, PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM } from "@/lib/ai-evaluation/service"
import {
  PUB_STATUS_NAME_TO_ID,
  PERSONAL_STATUS_NAME_TO_ID,
  INTEREST_DEFAULT_PERSONAL_NAMES,
  INTEREST_DEFAULT_PERSONAL_IDS,
  parseStatusList,
  parseSynopsisQualities,
  parsePredictionQualities,
  parsePredictionVersions,
  parsePredictionDeltas,
  toParam,
} from "@/lib/ai-evaluation/queue-filters"
import { Suspense } from "react"
import { unstable_cache } from "next/cache"
import type { ReactNode } from "react"
import { EvalTabLink } from "@/components/ai-evaluation/eval-tab-link"
import { StaleRerankPanel } from "@/components/ranking/stale-rerank-panel"
import { SynopsisPredictPanel } from "@/components/titles/synopsis-predict-panel"
import { ShadowComparePanel } from "@/components/titles/shadow-compare-panel"
import { PredictionDiagnosticsPopover } from "@/components/titles/prediction-diagnostics-popover"
import { isInterestShadowEnabled } from "@/lib/ai-evaluation/compiled-preferences"
import { getAlignmentQueueWorks, getSynopsisQueueWorks, getSynopsisPredictionVersions, getUntrackedWorks } from "@/server/queries/recommendations"
import type { AlignmentQueueWork, SynopsisQueueWork, UntrackedWork } from "@/server/queries/recommendations"
import { UntrackedStatusPanel } from "@/components/ai-evaluation/untracked-status-panel"
import { getSynopsisPredictionAccuracy, getSynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import type { SynopsisPredictionAccuracy, SynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import { canConsumeAi } from "@/server/queries/current-user"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { fetchAdultScoreFlags } from "@/server/queries/adult-score-flags"
import { getReadAckSets, getEvalReadSummary } from "@/server/queries/ai-eval-read"
import { getCurrentUserId } from "@/server/queries/current-user"
import type { ReadQueue } from "@/server/queries/ai-eval-read"
import { filterWorkIdsByInterest } from "@/server/queries/interest-filter"
import { MarkReadButton } from "@/components/ai-evaluation/mark-read-button"

const IA_RK_STATES = ["stale", "unranked"] as const
type IaRkState = (typeof IA_RK_STATES)[number]

function parseIaRkStates(raw: string | string[] | undefined): IaRkState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value == null) return ["stale"] // default: só "Desatualizado"
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return IA_RK_STATES.filter((s) => parts.includes(s))
}

const SYNOPSIS_STATES = ["stale", "unpredicted", "predicted"] as const
type SynopsisState = (typeof SYNOPSIS_STATES)[number]

function parseSynopsisStates(raw: string | string[] | undefined): SynopsisState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  // Default da fila de ação: só "não previsto" (sem "stale" nem "predicted").
  if (value == null) return ["unpredicted"]
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return SYNOPSIS_STATES.filter((s) => parts.includes(s))
}

/** Aviso de crédito de IA — só quando a leitura NÃO tem plano pago (free por crédito). */
function PaidActionNotice({ isPaid }: { isPaid: boolean }) {
  if (isPaid) return null
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-primary/10 px-3.5 py-2.5 text-xs text-foreground/90 ring-1 ring-inset ring-primary/25">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      Você vê a fila inteira. Calcular o Veredito IA e prever Interesse consomem crédito de IA — inclusos na
      assinatura, ou compre por obra.
    </div>
  )
}

/**
 * Aba "Veredito IA" — fila de re-rank: obras com Veredito IA desatualizado E/OU não avaliado
 * (sem Veredito IA ainda). Compartilha os filtros de Status com a aba de Interesse; troca
 * "Estado da avaliação" por "Estado do Veredito IA". Sort é no painel.
 */
function IaRkTab({
  works,
  readIds,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  predictionQualities,
  states,
  isPaid,
}: {
  works: AlignmentQueueWork[]
  readIds: string[]
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
  states: IaRkState[]
  isPaid: boolean
}) {
  return (
    <div className="space-y-4">
      <PaidActionNotice isPaid={isPaid} />
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={0.8}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        activePredictionQualities={predictionQualities}
        showEvalState={false}
        showIaRkState
        activeIaRkStates={states}
      />
      <StaleRerankPanel works={works} readIds={readIds} isPaid={isPaid} />
    </div>
  )
}

/**
 * Aba "Interesse na Obra" — fila de obras com sinopse canônica que precisam de
 * estimativa IA (desatualizada ou não prevista). Mesmo formato de cards da aba
 * Veredito IA. Compartilha os filtros de Status; só os de estado da avaliação não se
 * aplicam. Além de estimar, permite APLICAR a previsão em fila (preenche o
 * Interesse manual das obras sem rótulo).
 */
function SynopsisTab({
  works,
  readIds,
  accuracy,
  comparison,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  states,
  predictionVersions,
  predictionQualities,
  predictionDeltas,
  predictionVersionOptions,
  minTags,
  maxTags,
  minReviews,
  maxReviews,
  defaultPersonalStatuses,
  isPaid,
}: {
  works: SynopsisQueueWork[]
  readIds: string[]
  accuracy: SynopsisPredictionAccuracy
  comparison: SynopsisVersionComparison | null
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  states: SynopsisState[]
  predictionVersions: string[]
  predictionQualities: string[]
  predictionDeltas: string[]
  predictionVersionOptions: string[]
  minTags: number
  maxTags: number
  minReviews: number
  maxReviews: number
  defaultPersonalStatuses: string[]
  isPaid: boolean
}) {
  return (
    <div className="space-y-4">
      <PaidActionNotice isPaid={isPaid} />
      {/* Diagnóstico da previsão (confiança/versões/Shadow A/B) fora do topo: pílula
          discreta que abre um popover. O Shadow é server-only → passado como prop. */}
      <div className="flex justify-start">
        <PredictionDiagnosticsPopover
          accuracy={accuracy}
          comparison={comparison}
          shadow={isInterestShadowEnabled() ? <ShadowComparePanel comparison={comparison} /> : null}
        />
      </div>
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={0.8}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        showEvalState={false}
        showSynopsisState
        showDataFilters
        activeMinTags={minTags}
        activeMaxTags={maxTags}
        activeMinReviews={minReviews}
        activeMaxReviews={maxReviews}
        defaultPersonalStatuses={defaultPersonalStatuses}
        activeSynopsisStates={states}
        activePredictionVersions={predictionVersions}
        activePredictionQualities={predictionQualities}
        activePredictionDeltas={predictionDeltas}
        predictionVersionOptions={predictionVersionOptions}
      />
      <SynopsisPredictPanel works={works} readIds={readIds} isPaid={isPaid} />
    </div>
  )
}

/**
 * Aba "Untracked" — obras com status de leitura = Untracked. Permite atribuir um
 * status de leitura a VÁRIAS de uma vez (multi-seleção + aplicar). Reusa o filtro
 * de Publicação + Interesse (esconde "Leitura": todas são Untracked). "Definir
 * status" é ação LIVRE (não consome IA) — qualquer logado pode usar, sem "Pago".
 */
function UntrackedTab({
  works,
  readIds,
  pubStatusNames,
  synopsisQualities,
  predictionQualities,
}: {
  works: (UntrackedWork & {
    tagCount: number
    reviewCount: number
  })[]
  readIds: string[]
  pubStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={0.8}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={[]}
        activeSynopsisQualities={synopsisQualities}
        activePredictionQualities={predictionQualities}
        showEvalState={false}
        showPersonalStatus={false}
      />
      <UntrackedStatusPanel works={works} readIds={readIds} />
    </div>
  )
}

interface TabHrefs {
  rk: string
  syn: string
  untracked: string
}

/** Barra de abas. `counts=null` (fallback do Suspense) mostra "(…)" enquanto os
 *  contadores carregam — não bloqueia o render do conteúdo da aba ativa. */
function EvalTabBar({
  activeTab,
  hrefs,
  counts,
}: {
  activeTab: string
  hrefs: TabHrefs
  counts: TabCounts | null
}) {
  const n = (v: number | undefined) => (counts ? ` (${v ?? 0})` : " (…)")
  return (
    <div className="flex items-center gap-1 border-b border-border/60">
      <EvalTabLink href={hrefs.rk} active={activeTab === "ia-rk"} dot={(counts?.iaRk ?? 0) > 0}>Veredito IA{n(counts?.iaRk)}</EvalTabLink>
      <EvalTabLink href={hrefs.syn} active={activeTab === "sinopse"} dot={(counts?.syn ?? 0) > 0}>Interesse na Obra{n(counts?.syn)}</EvalTabLink>
      <EvalTabLink href={hrefs.untracked} active={activeTab === "untracked"}>Untracked{n(counts?.untracked)}</EvalTabLink>
    </div>
  )
}

interface CountArgs {
  pubStatusIds: number[]
  personalStatusIds: number[]
  synopsisQualities: string[]
  iaRkStates: IaRkState[]
  synopsisStates: SynopsisState[]
  predictionVersions: string[]
  predictionQualities: string[]
  predictionDeltas: string[]
}

interface TabCounts {
  iaRk: number
  syn: number
  untracked: number
}

async function _getRecomendacaoTabCounts(args: CountArgs): Promise<TabCounts> {
  const [iaRk, syn, untracked, ackSets] = await Promise.all([
    getAlignmentQueueWorks({ states: args.iaRkStates, pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds }),
    getSynopsisQueueWorks({ states: args.synopsisStates, pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, synopsisQualities: args.synopsisQualities, predictionVersions: args.predictionVersions, predictionQualities: args.predictionQualities, predictionDeltas: args.predictionDeltas, missingManual: args.synopsisQualities.includes("none"), countOnly: true }),
    getUntrackedWorks({ pubStatusIds: args.pubStatusIds }),
    getReadAckSets(),
  ])
  const ackVer = ackSets.get("veredito")!
  const ackInt = ackSets.get("interesse")!
  const ackUn = ackSets.get("untracked")!
  const verIds = iaRk.map((w) => w.id)
  const unIds = untracked.map((w) => w.id)
  // Interesse (manual + Previsão da IA) filtrado uniformemente pós-fetch nas 2
  // filas cujas queries não filtram por isso (a aba Interesse já filtra internamente).
  const [keepVer, keepUn] = await Promise.all([
    filterWorkIdsByInterest(verIds, args.synopsisQualities, args.predictionQualities),
    filterWorkIdsByInterest(unIds, args.synopsisQualities, args.predictionQualities),
  ])
  return {
    iaRk: verIds.filter((id) => keepVer.has(id) && !ackVer.has(id)).length,
    syn: syn.filter((w) => !ackInt.has(w.id)).length,
    untracked: unIds.filter((id) => keepUn.has(id) && !ackUn.has(id)).length,
  }
}

/**
 * Contagens das 3 abas de Fila de Recomendação, cacheadas por combinação de
 * filtros (`unstable_cache`). Metade do que era `getAiEvalTabCounts` antes de
 * /ai-evaluation virar duas páginas — a outra metade (IA Atributos, Tags &
 * Reviews) mora em app/ai-evaluation/page.tsx. Mesma tag de invalidação
 * (`ai-eval-tab-counts`) das duas páginas.
 *
 * ⚠️ `userId` PRECISA entrar na chave. As 3 leituras acima passaram a ser
 * per-usuário (status de leitura vem de `user_work_state`, não mais do dono) —
 * uma chave sem `userId` serviria a contagem de quem abriu a página primeiro
 * pros próximos 60s, pra qualquer um. Mesmo padrão de
 * `getFavoritesSummary` (server/queries/favorites.ts).
 */
async function getRecomendacaoTabCounts(args: CountArgs): Promise<TabCounts> {
  const userId = await getCurrentUserId()
  return unstable_cache(
    _getRecomendacaoTabCounts,
    ["recomendacao-tab-counts-v1", userId],
    { revalidate: 60, tags: ["ai-eval-tab-counts"] },
  )(args)
}

const ACTIVE_TAB_COUNT_KEY: Record<string, keyof TabCounts> = {
  "ia-rk": "iaRk",
  sinopse: "syn",
  untracked: "untracked",
}

/**
 * Contadores das 3 abas — async, renderizado dentro de um <Suspense> para NÃO
 * bloquear o conteúdo da aba ativa. `activeCount` é a contagem fresca da aba
 * ATIVA (a fila já foi buscada no corpo da página) — sobrescreve o valor
 * possivelmente cacheado.
 */
async function TabCountsBar({ activeTab, hrefs, args, activeCount }: { activeTab: string; hrefs: TabHrefs; args: CountArgs; activeCount: number }) {
  const counts = await getRecomendacaoTabCounts(args)
  const merged: TabCounts = { ...counts, [ACTIVE_TAB_COUNT_KEY[activeTab] ?? "iaRk"]: activeCount }
  return <EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={merged} />
}

const RECOMENDACAO_QUEUES: readonly ReadQueue[] = ["veredito", "interesse", "untracked"]

/**
 * Estado do toggle "Marcar tudo como lido" das 3 filas de Fila de Recomendação.
 * Cacheado (60s + tag `ai-eval-tab-counts`) pra não re-varrer as filas a cada
 * navegação. Renderiza no slot de ações do Header.
 *
 * ⚠️ `userId` na chave pelo mesmo motivo de `getRecomendacaoTabCounts`: as 3
 * filas que alimentam este resumo já são per-usuário. Aqui é ainda mais crítico
 * — a função não recebe NENHUM argumento, então sem `userId` não haveria
 * diferenciação nenhuma por usuário (a chave seria 100% global).
 */
async function getEvalReadSummaryCached() {
  const userId = await getCurrentUserId()
  return unstable_cache(
    () => getEvalReadSummary(RECOMENDACAO_QUEUES),
    ["ai-eval-read-summary-recomendacao-v1", userId],
    { revalidate: 60, tags: ["ai-eval-tab-counts"] },
  )()
}

async function MarkReadControl() {
  const summary = await getEvalReadSummaryCached()
  // Nada pendente nem lido ⇒ nada a fazer: esconde o botão.
  if (!summary.hasAnyRead && summary.totalUnread === 0) return null
  return <MarkReadButton allRead={summary.allRead} queues={RECOMENDACAO_QUEUES} badgeKey="recQueue" />
}

export const metadata = { title: "Fila de recomendação" }

export default async function FilaRecomendacaoPage({
  searchParams,
}: {
  searchParams: Promise<{
    pub?: string | string[]
    personal?: string | string[]
    synopsis_q?: string | string[]
    tab?: string | string[]
    rk?: string | string[]
    sq?: string | string[]
    pv?: string | string[]
    pq?: string | string[]
    pd?: string | string[]
    maxrev?: string | string[]
    maxtags?: string | string[]
    minrev?: string | string[]
    mintags?: string | string[]
  }>
}) {
  const params = await searchParams
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const activeTab: "ia-rk" | "sinopse" | "untracked" =
    tabRaw === "sinopse" ? "sinopse"
    : tabRaw === "untracked" ? "untracked"
    : "ia-rk"

  const parseMax = (v: string | string[] | undefined): number => {
    const raw = Array.isArray(v) ? v[0] : v
    const n = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : 0
    return Math.max(0, n)
  }
  const maxReviews = parseMax(params.maxrev)
  const maxTags = parseMax(params.maxtags)
  const minReviews = parseMax(params.minrev)
  const minTags = parseMax(params.mintags)

  // Filtros de Status + interesse compartilhados pelas 3 abas.
  const { names: pubStatusNames, ids: pubStatusIds } = parseStatusList(params.pub, PUB_STATUS_NAME_TO_ID)
  const { names: personalStatusNames, ids: personalStatusIds } = parseStatusList(
    params.personal,
    PERSONAL_STATUS_NAME_TO_ID,
  )
  const synopsisQualities = parseSynopsisQualities(params.synopsis_q)
  const iaRkStates = parseIaRkStates(params.rk)
  const synopsisStates = parseSynopsisStates(params.sq)
  const predictionVersions = parsePredictionVersions(params.pv)
  const predictionQualities = parsePredictionQualities(params.pq)
  const predictionDeltas = parsePredictionDeltas(params.pd)

  // Adiar contadores (Suspense): busca SÓ os dados da aba ATIVA (render rápido).
  // Os contadores das 3 abas rodam num <Suspense> separado (TabCountsBar), sem
  // bloquear. Plano só é usado nas abas com features pagas (sinopse / ia-rk).
  const needsPlan = activeTab === "sinopse" || activeTab === "ia-rk"
  const canAiPromise = needsPlan ? canConsumeAi() : null

  // Obras marcadas como "lidas" por fila (silenciadas). Os cards exibem o selo
  // "Lida" e o activeCount abaixo desconta as lidas (bate com o contador da aba).
  const ackSets = await getReadAckSets()
  const readIdsFor = (queue: ReadQueue, works: { id: string }[]): string[] => {
    const set = ackSets.get(queue)!
    return works.filter((w) => set.has(w.id)).map((w) => w.id)
  }

  let activeContent: ReactNode = null
  // Contagem fresca da aba ativa — sobrescreve o valor cacheado no TabCountsBar.
  let activeCount = 0
  if (activeTab === "sinopse") {
    // Default da aba: quando o usuário NÃO escolheu status, mostra todos MENOS
    // Completed/Dropped/Stalled (o filtro exibe esses selecionados). Escolha
    // explícita de status sobrepõe.
    const sinopseUsesDefaultPersonal = personalStatusNames.length === 0
    const sinopsePersonalNames = sinopseUsesDefaultPersonal ? INTEREST_DEFAULT_PERSONAL_NAMES : personalStatusNames
    const sinopsePersonalIds = sinopseUsesDefaultPersonal ? INTEREST_DEFAULT_PERSONAL_IDS : personalStatusIds
    const [synopsisQueue, predictionVersionOptions, synopsisAccuracy, synopsisComparison, canAi] = await Promise.all([
      getSynopsisQueueWorks({ states: synopsisStates, pubStatusIds, personalStatusIds: sinopsePersonalIds, synopsisQualities, predictionVersions, predictionQualities, predictionDeltas, missingManual: synopsisQualities.includes("none") }),
      getSynopsisPredictionVersions(),
      getSynopsisPredictionAccuracy(),
      getSynopsisVersionComparison(),
      canAiPromise ?? canConsumeAi(),
    ])
    const isPaidPlan = canAi
    // Só as contagens 🏷/💬 (badge + filtro de faixa) entram no crítico. Os inputs
    // pesados do popover (sinopse/tags/digest) carregam sob demanda ao abrir.
    const idsToHydrate = synopsisQueue.map((w) => w.id)
    const [counts, flags] = await Promise.all([
      getWorkTagReviewCounts(idsToHydrate),
      fetchAdultScoreFlags(idsToHydrate),
    ])
    let works = synopsisQueue.map((w) => {
      const c = counts.get(w.id)
      const f = flags.get(w.id)
      return {
        ...w,
        tagCount: c?.tagCount ?? 0,
        reviewCount: c?.reviewCount ?? 0,
        isAdult: f?.isAdult ?? false,
        userScore: f?.userScore ?? null,
      }
    })
    // Filtro "Dados (nº)": faixa mín–máx de tags/reviews (aba sinopse), pós-hidratação
    // dos counts. O activeCount reflete o pós-filtro pra o badge da aba bater com a lista.
    if (minTags > 0) works = works.filter((w) => (w.tagCount ?? 0) >= minTags)
    if (maxTags > 0) works = works.filter((w) => (w.tagCount ?? 0) <= maxTags)
    if (minReviews > 0) works = works.filter((w) => (w.reviewCount ?? 0) >= minReviews)
    if (maxReviews > 0) works = works.filter((w) => (w.reviewCount ?? 0) <= maxReviews)
    const readIds = readIdsFor("interesse", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <SynopsisTab
        works={works}
        readIds={readIds}
        accuracy={synopsisAccuracy}
        comparison={synopsisComparison}
        pubStatusNames={pubStatusNames}
        personalStatusNames={sinopsePersonalNames}
        defaultPersonalStatuses={INTEREST_DEFAULT_PERSONAL_NAMES}
        synopsisQualities={synopsisQualities}
        states={synopsisStates}
        predictionVersions={predictionVersions}
        predictionQualities={predictionQualities}
        predictionDeltas={predictionDeltas}
        predictionVersionOptions={predictionVersionOptions}
        minTags={minTags}
        maxTags={maxTags}
        minReviews={minReviews}
        maxReviews={maxReviews}
        isPaid={isPaidPlan}
      />
    )
  } else if (activeTab === "untracked") {
    const untrackedAll = await getUntrackedWorks({ pubStatusIds })
    const keep = await filterWorkIdsByInterest(untrackedAll.map((w) => w.id), synopsisQualities, predictionQualities)
    const untrackedWorks = untrackedAll.filter((w) => keep.has(w.id))
    // Inputs do popover carregam sob demanda (getSynopsisInputsAction) — só as
    // contagens 🏷/💬 entram no crítico.
    const idsToHydrate = untrackedWorks.map((w) => w.id)
    const [counts, flags] = await Promise.all([
      getWorkTagReviewCounts(idsToHydrate),
      fetchAdultScoreFlags(idsToHydrate),
    ])
    const works = untrackedWorks.map((w) => {
      const c = counts.get(w.id)
      const f = flags.get(w.id)
      return {
        ...w,
        tagCount: c?.tagCount ?? 0,
        reviewCount: c?.reviewCount ?? 0,
        isAdult: f?.isAdult ?? false,
        userScore: f?.userScore ?? null,
      }
    })
    const readIds = readIdsFor("untracked", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <UntrackedTab
        works={works}
        readIds={readIds}
        pubStatusNames={pubStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
      />
    )
  } else {
    const [iaRkQueue, canAi] = await Promise.all([
      getAlignmentQueueWorks({ states: iaRkStates, pubStatusIds, personalStatusIds }),
      canAiPromise ?? canConsumeAi(),
    ])
    const isPaidPlan = canAi
    const keep = await filterWorkIdsByInterest(iaRkQueue.map((w) => w.id), synopsisQualities, predictionQualities)
    const members = iaRkQueue.filter((w) => keep.has(w.id))
    const memberIds = members.map((w) => w.id)
    const [counts, flags] = await Promise.all([
      getWorkTagReviewCounts(memberIds),
      fetchAdultScoreFlags(memberIds),
    ])
    const works = members.map((w) => ({
      ...w,
      tagCount: counts.get(w.id)?.tagCount ?? 0,
      reviewCount: counts.get(w.id)?.reviewCount ?? 0,
      isAdult: flags.get(w.id)?.isAdult ?? false,
      userScore: flags.get(w.id)?.userScore ?? null,
    }))
    const readIds = readIdsFor("veredito", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <IaRkTab
        works={works}
        readIds={readIds}
        pubStatusNames={pubStatusNames}
        personalStatusNames={personalStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
        states={iaRkStates}
        isPaid={isPaidPlan}
      />
    )
  }

  // Preserva os filtros ao trocar de aba.
  const pub = toParam(params.pub)
  const personal = toParam(params.personal)
  const synq = toParam(params.synopsis_q)
  const rk = toParam(params.rk)
  const sq = toParam(params.sq)
  const pv = toParam(params.pv)
  const pq = toParam(params.pq)
  const pd = toParam(params.pd)

  const rkParams = new URLSearchParams({ tab: "ia-rk" })
  if (pub) rkParams.set("pub", pub)
  if (personal) rkParams.set("personal", personal)
  if (synq) rkParams.set("synopsis_q", synq)
  if (rk) rkParams.set("rk", rk)
  const rkHref = `/fila-recomendacao?${rkParams}`

  const synParams = new URLSearchParams({ tab: "sinopse" })
  if (pub) synParams.set("pub", pub)
  if (personal) synParams.set("personal", personal)
  if (synq) synParams.set("synopsis_q", synq)
  if (sq) synParams.set("sq", sq)
  if (pv) synParams.set("pv", pv)
  if (pq) synParams.set("pq", pq)
  if (pd) synParams.set("pd", pd)
  const synHref = `/fila-recomendacao?${synParams}`

  const untrackedParams = new URLSearchParams({ tab: "untracked" })
  if (pub) untrackedParams.set("pub", pub)
  if (synq) untrackedParams.set("synopsis_q", synq)
  const untrackedHref = `/fila-recomendacao?${untrackedParams}`

  const hrefs: TabHrefs = { rk: rkHref, syn: synHref, untracked: untrackedHref }
  const countArgs: CountArgs = {
    pubStatusIds,
    personalStatusIds,
    synopsisQualities,
    iaRkStates,
    synopsisStates,
    predictionVersions,
    predictionQualities,
    predictionDeltas,
  }

  return (
    <div className="space-y-4">
      <Header
        title="Fila de Recomendação"
        description="Mantém suas notas pessoais em dia: o quanto cada obra combina com seu gosto (Veredito IA) e sua previsão de Interesse antes de decidir ler."
        icon={<Clock />}
        actions={
          <Suspense fallback={null}>
            <MarkReadControl />
          </Suspense>
        }
      />

      <Suspense fallback={<EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={null} />}>
        <TabCountsBar activeTab={activeTab} hrefs={hrefs} args={countArgs} activeCount={activeCount} />
      </Suspense>

      {activeContent}
    </div>
  )
}
