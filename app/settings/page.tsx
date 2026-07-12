import { Suspense } from "react"
import type { ReactNode } from "react"
import { promises as fs } from "node:fs"
import path from "node:path"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { SettingsCard } from "@/components/settings/settings-card"
import { ConsoleSectionNote } from "@/components/console/console-section"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import {
  CalibrationAuditTool,
  CalibrationBiasTool,
} from "@/components/settings/calibration/calibration-criteria-tool"
import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { SynopsisConsolidationPanel } from "@/components/settings/synopsis-consolidation-panel"
import { ReviewSummaryPanel } from "@/components/settings/review-summary-panel"
import { ReviewDigestPanel } from "@/components/settings/review-digest-panel"
import { ResolveComixPanel } from "@/components/settings/resolve-comix-panel"
import { ComixHealthPanel } from "@/components/settings/comix-health-panel"
import { ProtectedSourcesHealthPanel } from "@/components/settings/protected-sources-health-panel"
import { AiEvalOnCreateToggle } from "@/components/settings/ai-eval-on-create-toggle"
import { SynopsisCanonicalOnCreateToggle } from "@/components/settings/synopsis-canonical-on-create-toggle"
import { ReviewSummaryEnabledToggle } from "@/components/settings/review-summary-enabled-toggle"
import { ReviewDigestEnabledToggle } from "@/components/settings/review-digest-enabled-toggle"
import { ScoreWeightsAutoToggle } from "@/components/settings/score-weights-auto-toggle"
import { TagInferenceOnCreateToggle } from "@/components/settings/tag-inference-on-create-toggle"
import { InterestShadowOnCreateToggle } from "@/components/settings/interest-shadow-on-create-toggle"
import { GenerateAllOnCreateToggle } from "@/components/settings/generate-all-on-create-toggle"
import {
  TagConsolidationTool,
  type TagConsolidationParams,
} from "@/components/settings/tag-consolidation/tag-consolidation-tool"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import { getComixResolverStatus } from "@/server/actions/comix-resolver"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import {
  getAiEvalOnCreate,
  getSynopsisCanonicalOnCreate,
  getReviewSynthesisToggles,
  getTagInferenceOnCreate,
  getInterestShadowOnCreate,
  getGenerateAllOnCreate,
} from "@/server/queries/current-user"
import {
  countMissingEmbeddings,
  countPendingCanonicalSynopses,
  countPendingReviewSummaries,
  getSettingsItemPending,
} from "@/server/queries/settings-pending"
import {
  BATCH_READ_SECTIONS,
  getSettingsItemUnread,
  getSettingsReadAcks,
  getSuggestionReadAckIds,
} from "@/server/queries/settings-read"
import { MarkAllReadButton } from "@/components/settings/mark-all-read-button"
import { CardMarkRead } from "@/components/settings/card-mark-read"
import { parseModelEvaluationMetrics } from "@/lib/metrics/model-evaluation"
import type { FormulaConfig } from "@/types/domain"
import type { SettingsAccent } from "@/lib/settings-accent"
import {
  DEFAULT_GROUP_ID,
  findGroup,
  groupIdOfSection,
  normalizeGroupId,
  normalizeOpenId,
  SETTINGS_GROUPS,
} from "@/app/settings/sections"
import type { SettingsSection } from "@/app/settings/sections"
import { cn } from "@/lib/utils"

async function getSyncConstantsMtime(): Promise<string | null> {
  try {
    const stat = await fs.stat(path.join(process.cwd(), "lib/constants/criteria.ts"))
    return stat.mtime.toISOString()
  } catch {
    return null
  }
}

function activeWorksCount() {
  const supabase = createAdminClient()
  return supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .eq("is_archived", false)
    .then((r) => r.count ?? 0)
}

const firstParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<
    {
      g?: string | string[]
      open?: string | string[]
      s?: string | string[]
    } & Record<keyof TagConsolidationParams, string | string[] | undefined>
  >
}) {
  const sp = await searchParams

  // Resolve o tópico ativo. `?g=` é a fonte; `?s=<item>` (deep-link antigo) é
  // resolvido pro grupo dono do item (e abre a ferramenta, se for colapsável).
  let groupId = normalizeGroupId(sp.g)
  let openId = normalizeOpenId(sp.open)
  const legacy = Array.isArray(sp.s) ? sp.s[0] : sp.s
  if (!groupId && legacy) {
    groupId = groupIdOfSection(legacy)
    if (!openId) openId = normalizeOpenId(legacy)
  }

  // Params da ferramenta de tags (só usados quando o card "tags" está expandido).
  const tagParams: TagConsolidationParams = {
    view: firstParam(sp.view),
    group: firstParam(sp.group),
    status: firstParam(sp.status),
    phase: firstParam(sp.phase),
  }

  const group = findGroup(groupId ?? DEFAULT_GROUP_ID) ?? SETTINGS_GROUPS[0]
  const accent = group.accent
  const s = ACCENT_STYLES[accent]
  const GroupIcon = group.icon
  // Itens do tópico ganham seta de colapso — exceto quando o tópico tem 1 só.
  const collapsible = group.sections.length > 1
  // Pendência REAL por item (`itemPending`) + NÃO-LIDO por item (`itemUnread`, o
  // que vira a pílula do card e o badge). Os acks dizem quais seções batch já têm
  // snapshot (selo "Lida") e quantas sugestões foram silenciadas. O
  // getSettingsItemPending é memoizado por request → compartilha a computação com
  // o layout (sub-nav) e com getSettingsItemUnread.
  const [itemPending, itemUnread, batchAcks, suggestionAckIds] = await Promise.all([
    getSettingsItemPending(),
    getSettingsItemUnread(),
    getSettingsReadAcks(),
    getSuggestionReadAckIds(),
  ])
  const batchReadSet = new Set<string>(BATCH_READ_SECTIONS as readonly string[])
  const totalUnread = Object.values(itemUnread).reduce((sum, n) => sum + n, 0)
  const hasAnyRead = batchAcks.size > 0 || suggestionAckIds.length > 0
  // Botão global: aparece quando há algo a marcar OU algo já lido; vira "Desmarcar
  // tudo" quando tudo está lido (algo lido e nenhuma pendência não-lida).
  const showMarkAll = totalUnread > 0 || hasAnyRead
  const allRead = hasAnyRead && totalUnread === 0

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6 flex items-center gap-3.5">
        <div
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-xl ring-1 [&_svg]:size-6",
            s.iconBg,
            s.iconText,
            s.ring
          )}
        >
          <GroupIcon />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{group.label}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">{group.hint}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showMarkAll && <MarkAllReadButton allRead={allRead} />}
          <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            {group.sections.length} {group.sections.length === 1 ? "item" : "itens"}
          </span>
        </div>
      </header>

      <div className="space-y-4">
        {group.sections.map((section) => {
          const isOpen = openId === section.id
          // Ferramentas pesadas de calibração: colapso ÚNICO pelo servidor — a
          // seta do header abre/recolhe via `?open=` e o corpo só renderiza quando
          // aberto (adia o load), sem o botão "Abrir auditoria" redundante.
          const usesServerCollapse = section.id === "ai-audit" || section.id === "ai-bias"
          const serverCollapse = usesServerCollapse
            ? {
                open: isOpen,
                href: isOpen
                  ? `/settings?g=${group.id}#card-${section.id}`
                  : `/settings?g=${group.id}&open=${section.id}#card-${section.id}`,
              }
            : undefined
          // Cards agregados (batch) ganham o botão/selo "Marcar como lido" no
          // header. O 'ai-audit' NÃO — sua pendência é silenciada 1-a-1 (selo por
          // sugestão dentro do card). Cards sem pendência acionável: sem controle.
          const isBatch = batchReadSet.has(section.id)
          const unread = itemUnread[section.id] ?? 0
          return (
            <SettingsCard
              key={section.id}
              section={section}
              accent={accent}
              collapsible={serverCollapse ? false : collapsible}
              forceOpen={isOpen}
              serverCollapse={serverCollapse}
              storageKeyPrefix="settings-card"
              pending={unread}
              readControl={
                isBatch ? (
                  <CardMarkRead
                    section={section.id}
                    pending={itemPending[section.id] ?? 0}
                    unread={unread}
                    isRead={batchAcks.has(section.id)}
                  />
                ) : undefined
              }
            >
              <Suspense fallback={<BodySkeleton />}>
                <ItemBody section={section} accent={accent} open={isOpen} tagParams={tagParams} />
              </Suspense>
            </SettingsCard>
          )
        })}
      </div>

      <ScrollToTop />
    </div>
  )
}

// ── Corpo de cada card (lazy, streamado por <Suspense>) ──────────────────────
async function ItemBody({
  section,
  accent,
  open,
  tagParams,
}: {
  section: SettingsSection
  accent: SettingsAccent
  open: boolean
  tagParams: TagConsolidationParams
}) {
  switch (section.id) {
    case "calibration": {
      const supabase = createAdminClient()
      const [configRes, snapshot, embeddings, canonicalSynopsis, reviewSummary] = await Promise.all([
        supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
        getCalibrationSnapshot(),
        countMissingEmbeddings(),
        countPendingCanonicalSynopses(),
        countPendingReviewSummaries(),
      ])
      if (configRes.error) throw new Error(configRes.error.message)
      const config = configRes.data?.[0] as FormulaConfig | undefined
      if (!config) throw new Error("formula_config não encontrado")

      const modelMetrics = parseModelEvaluationMetrics({
        trainMae: config.mae_expected,
        crossValidationMae: snapshot.expectedPredictorIsStub ? null : config.cv_mae_expected_stage1,
        prospectiveMae: null,
        baselineMae: snapshot.baselineMae,
        sampleSize: snapshot.trainSize,
        foldCount: null,
        evaluatedAt: config.last_recalculated_at,
        prospectiveSampleSize: null,
        prospectiveEvaluatedAt: null,
      })

      return (
        <div className="space-y-4">
          <ConsoleSectionNote accent="violet">
            A calibração usa o kNN dos{" "}
            <Link
              href="/settings?g=ia#card-embeddings"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Embeddings
            </Link>{" "}
            — atualize-os (Passo 1, grupo &ldquo;Gerado por IA&rdquo;) antes de recalibrar (Passo 2).
          </ConsoleSectionNote>
          <CalibrationPanel
            config={config}
            metrics={modelMetrics}
            snapshot={snapshot}
            accent="violet"
            aiPending={[
              { label: "Embeddings", count: embeddings, href: "/settings?g=ia#card-embeddings" },
              {
                label: "Sinopse canônica",
                count: canonicalSynopsis,
                href: "/settings?g=ia#card-synopsis-canonical",
              },
              {
                label: "Resumo de reviews",
                count: reviewSummary,
                href: "/settings?g=ia#card-review-synthesis",
              },
            ]}
          />
        </div>
      )
    }

    // Colapso pelo SettingsCard (serverCollapse): o corpo só chega aqui quando o
    // card está aberto, então renderizamos a ferramenta direto — sem "Abrir".
    case "ai-audit":
      return <CalibrationAuditTool />

    case "ai-bias":
      return <CalibrationBiasTool />

    case "embeddings": {
      const supabase = createAdminClient()
      const [embeddingsCount, worksCount, lastRunRes, pendingCount] = await Promise.all([
        supabase
          .from("work_embeddings")
          .select("work_id", { count: "exact", head: true })
          .then((r) => r.count ?? 0),
        activeWorksCount(),
        supabase
          .from("work_embeddings")
          .select("updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        countMissingEmbeddings(),
      ])
      return (
        <EmbeddingsPanel
          accent={accent}
          initialCachedCount={embeddingsCount}
          initialPendingCount={pendingCount}
          totalWorks={worksCount}
          initialLastRun={(lastRunRes.data?.updated_at as string | undefined) ?? null}
        />
      )
    }

    case "synopsis-canonical": {
      const [worksCount, pendingCount] = await Promise.all([
        activeWorksCount(),
        countPendingCanonicalSynopses(),
      ])
      return (
        <SynopsisConsolidationPanel accent={accent} pendingCount={pendingCount} totalCount={worksCount} />
      )
    }

    case "review-synthesis": {
      const [worksCount, pendingCount] = await Promise.all([
        activeWorksCount(),
        countPendingReviewSummaries(),
      ])
      return (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Resumo · exibido no app</p>
            <ReviewSummaryPanel accent={accent} pendingCount={pendingCount} totalCount={worksCount} />
          </div>
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-sm font-semibold text-foreground">
              Digest estruturado · consumido pela IA
            </p>
            <ReviewDigestPanel accent={accent} />
          </div>
        </div>
      )
    }

    case "cloudflare-sources": {
      return (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Diagnóstico</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Mangago e AnimePlanet devolvem 403 (challenge do Cloudflare) num fetch direto, então
              só respondem via bypass. O canário puxa um detalhe real de cada uma pra dizer se elas
              estão puxando dados <em>agora</em> — um bypass vivo mas com o solve falhando derruba as
              duas do mesmo jeito.
            </p>
            <ProtectedSourcesHealthPanel accent="amber" />
          </div>
        </div>
      )
    }

    case "comix": {
      const [comixStatus, comixMissing] = await Promise.all([
        getComixResolverStatus(),
        getWorksMissingComixHid(),
      ])
      const missingCount = comixMissing.length
      return (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Diagnóstico</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Testa se as chamadas pra Comix estão funcionando (FlareSolverr, detalhe, reviews,
              imagem) sem precisar abrir uma obra.
            </p>
            <ComixHealthPanel accent="amber" />
          </div>

          {/* Cobertura: recolhida por padrão; abre sozinha quando há hid pendente. */}
          <details open={missingCount > 0} className="group/cob border-t border-border/60 pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 -rotate-90 text-muted-foreground transition-transform group-open/cob:rotate-0" />
              <span className="text-sm font-semibold text-foreground">Cobertura</span>
              {missingCount > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold leading-none text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
                  {missingCount}
                </span>
              )}
            </summary>
            <div className="pt-3">
              <ResolveComixPanel accent="amber" initialStatus={comixStatus} initialMissing={comixMissing} />
            </div>
          </details>
        </div>
      )
    }

    case "on-create": {
      const supabase = createAdminClient()
      const [
        aiEvalOnCreate,
        synopsisCanonicalOnCreate,
        tagInferenceOnCreate,
        reviewToggles,
        interestShadowOnCreate,
        generateAllOnCreate,
        weightsConfigRes,
      ] = await Promise.all([
        getAiEvalOnCreate(),
        getSynopsisCanonicalOnCreate(),
        getTagInferenceOnCreate(supabase),
        getReviewSynthesisToggles(supabase),
        getInterestShadowOnCreate(supabase),
        getGenerateAllOnCreate(supabase),
        supabase
          .from("formula_config")
          .select("score_weights_auto")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      const scoreWeightsAuto =
        (weightsConfigRes.data?.score_weights_auto as boolean | undefined) ?? true
      return (
        <div className="divide-y divide-border/60">
          <div className="pb-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">
              Gerar todos os dados na criação{" "}
              <span className="text-xs font-normal text-muted-foreground">(cascata · gate de fontes · ~$0,13)</span>
            </p>
            <GenerateAllOnCreateToggle initialEnabled={generateAllOnCreate} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Avaliação IA</p>
            <AiEvalOnCreateToggle initialEnabled={aiEvalOnCreate} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Sinopse canônica</p>
            <SynopsisCanonicalOnCreateToggle initialEnabled={synopsisCanonicalOnCreate} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Inferência de tags por IA</p>
            <TagInferenceOnCreateToggle initialEnabled={tagInferenceOnCreate} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Resumo de reviews</p>
            <ReviewSummaryEnabledToggle initialEnabled={reviewToggles.summaryEnabled} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Digest de reviews</p>
            <ReviewDigestEnabledToggle initialEnabled={reviewToggles.digestEnabled} />
          </div>
          <div className="py-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">
              Previsão de Interesse — shadow A/B{" "}
              <span className="text-xs font-normal text-muted-foreground">(dev · dobra custo)</span>
            </p>
            <InterestShadowOnCreateToggle initialEnabled={interestShadowOnCreate} />
          </div>
          <div className="pt-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Pesos automáticos dos atributos</p>
            <ScoreWeightsAutoToggle initialEnabled={scoreWeightsAuto} />
          </div>
        </div>
      )
    }

    case "tags":
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Revise os clusters semânticos e mescle tags duplicadas propostas pela IA.
            </p>
            <ExpandControl
              groupId="avancado"
              sectionId="tags"
              open={open}
              openLabel="Abrir consolidação"
            />
          </div>
          {open && (
            <div className="border-t border-border/60 pt-4">
              <Suspense fallback={<BodySkeleton />}>
                <TagConsolidationTool params={tagParams} basePath="/settings" />
              </Suspense>
            </div>
          )}
        </div>
      )

    case "sync": {
      const syncConstantsLastRun = await getSyncConstantsMtime()
      return <SyncConstantsPanel initialLastRun={syncConstantsLastRun} accent="slate" />
    }

    default:
      return null
  }
}

// Link que expande/recolhe uma ferramenta pesada inline (via ?open=), sem navegar.
function ExpandControl({
  groupId,
  sectionId,
  open,
  openLabel,
}: {
  groupId: string
  sectionId: string
  open: boolean
  openLabel: string
}) {
  const href = open
    ? `/settings?g=${groupId}#card-${sectionId}`
    : `/settings?g=${groupId}&open=${sectionId}#card-${sectionId}`
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
    >
      <ChevronDown className={cn("size-4 transition-transform", open ? "" : "-rotate-90")} />
      {open ? "Recolher" : openLabel}
    </Link>
  )
}

function BodySkeleton(): ReactNode {
  return (
    <div className="space-y-2">
      <div className="h-9 w-full animate-pulse rounded bg-muted/60" />
      <div className="h-9 w-3/4 animate-pulse rounded bg-muted/60" />
    </div>
  )
}
