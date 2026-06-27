import type { ReactNode } from "react"
import { promises as fs } from "node:fs"
import path from "node:path"
import {
  Activity,
  ArrowRight,
  BookOpen,
  Brain,
  Compass,
  Database,
  Gauge,
  Info,
  Layers,
  Settings,
  Sparkles,
  Tags,
} from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { SynopsisConsolidationPanel } from "@/components/settings/synopsis-consolidation-panel"
import { ReviewSummaryPanel } from "@/components/settings/review-summary-panel"
import { ReviewDigestPanel } from "@/components/settings/review-digest-panel"
import { ResolveComixPanel } from "@/components/settings/resolve-comix-panel"
import { ComixHealthPanel } from "@/components/settings/comix-health-panel"
import { AiEvalOnCreateToggle } from "@/components/settings/ai-eval-on-create-toggle"
import { SynopsisCanonicalOnCreateToggle } from "@/components/settings/synopsis-canonical-on-create-toggle"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import { getComixResolverStatus } from "@/server/actions/comix-resolver"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import { getAiEvalOnCreate, getSynopsisCanonicalOnCreate } from "@/server/queries/current-user"
import { getSettingsPendingCounts } from "@/server/queries/settings-pending"
import { parseModelEvaluationMetrics } from "@/lib/metrics/model-evaluation"
import type { FormulaConfig } from "@/types/domain"
import { ACCENT_LINK, type SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"

async function getSyncConstantsMtime(): Promise<string | null> {
  // criteria.ts is always rewritten by `npm run sync-constants`, so its mtime
  // is the best proxy for "last triggered".
  try {
    const stat = await fs.stat(path.join(process.cwd(), "lib/constants/criteria.ts"))
    return stat.mtime.toISOString()
  } catch {
    return null
  }
}

async function getSettingsData() {
  const supabase = createAdminClient()

  const [
    configRes,
    snapshot,
    embeddingsCount,
    worksCount,
    embeddingsLastRunRes,
    syncConstantsLastRun,
    pending,
  ] = await Promise.all([
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    getCalibrationSnapshot(),
    supabase
      .from("work_embeddings")
      .select("work_id", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
    supabase
      .from("works")
      .select("id", { count: "exact", head: true })
      .eq("is_archived", false)
      .then((r) => r.count ?? 0),
    supabase
      .from("work_embeddings")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getSyncConstantsMtime(),
    getSettingsPendingCounts(),
  ])

  const [comixStatus, comixMissing, aiEvalOnCreate, synopsisCanonicalOnCreate] = await Promise.all([
    getComixResolverStatus(),
    getWorksMissingComixHid(),
    getAiEvalOnCreate(),
    getSynopsisCanonicalOnCreate(),
  ])

  if (configRes.error) throw new Error(configRes.error.message)
  if (!configRes.data?.[0]) throw new Error("formula_config não encontrado")

  return {
    config: configRes.data?.[0] as FormulaConfig,
    snapshot,
    embeddingsCount,
    worksCount,
    embeddingsLastRun: (embeddingsLastRunRes.data?.updated_at as string | undefined) ?? null,
    syncConstantsLastRun,
    canonicalSynopsisPending: pending.canonicalSynopsis,
    embeddingsPending: pending.embeddings,
    reviewSummaryPending: pending.reviewSummary,
    comixStatus,
    comixMissing,
    aiEvalOnCreate,
    synopsisCanonicalOnCreate,
  }
}

const SECTION_GROUPS = [
  {
    label: "Pipeline de dados",
    sections: [
      { id: "embeddings", title: "Embeddings", icon: <Brain />, accent: "emerald" as const },
      { id: "calibration", title: "Calibração", icon: <Gauge />, accent: "cyan" as const },
      { id: "synopsis-canonical", title: "Sinopse canônica", icon: <Brain />, accent: "violet" as const },
      { id: "review-summary", title: "Resumo de reviews", icon: <Sparkles />, accent: "amber" as const },
      { id: "review-digest", title: "Digest de reviews", icon: <Layers />, accent: "amber" as const },
    ],
  },
  {
    label: "Casos especiais",
    sections: [
      { id: "sync", title: "Sincronização", icon: <Database />, accent: "indigo" as const },
      { id: "ai-calibration", title: "Calibração IA", icon: <Sparkles />, accent: "rose" as const },
      { id: "tags", title: "Consolidação de tags", icon: <Tags />, accent: "fuchsia" as const },
    ],
  },
  {
    label: "Comix & criação",
    sections: [
      { id: "comix-health", title: "Diagnóstico Comix", icon: <Activity />, accent: "slate" as const },
      { id: "comix", title: "Comix", icon: <BookOpen />, accent: "slate" as const },
      { id: "ai-on-create", title: "Avaliação na criação", icon: <Sparkles />, accent: "amber" as const },
    ],
  },
]

export default async function SettingsPage() {
  const {
    config,
    snapshot,
    embeddingsCount,
    worksCount,
    embeddingsLastRun,
    syncConstantsLastRun,
    canonicalSynopsisPending,
    embeddingsPending,
    reviewSummaryPending,
    comixStatus,
    comixMissing,
    aiEvalOnCreate,
    synopsisCanonicalOnCreate,
  } = await getSettingsData()

  // F4: métricas de erro honestas, validadas por Zod no boundary do servidor.
  // crossValidationMae é gated por stub (mesma regra antiga da headline). A
  // prospectiva ainda não entra aqui — vive na página técnica /admin/model-metrics.
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
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Configurações"
        description="Manutenção, calibração e parâmetros derivados"
        icon={<Settings />}
      />

      <SettingsIndex />

      <IndexSpacer />

      {/* ── Pipeline de dados ─────────────────────────────────────── */}
      <GroupHeading label="Pipeline de dados" />
      <RecommendedOrderBanner />

      <SettingsSection
        id="embeddings"
        title="Embeddings das obras"
        description="Representação vetorial via OpenAI para 'obras parecidas' e kNN predictor. Cacheado por obra — só re-embeda quando sinopse/tags/critérios mudam."
        icon={<Brain />}
        accent="emerald"
        badge={{ label: "Passo 1", variant: "step" }}
      >
        <EmbeddingsPanel
          accent="emerald"
          initialCachedCount={embeddingsCount}
          initialPendingCount={embeddingsPending}
          totalWorks={worksCount}
          initialLastRun={embeddingsLastRun}
        />
      </SettingsSection>

      <SettingsSection
        id="calibration"
        title="Calibração automática"
        description="MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado."
        icon={<Gauge />}
        accent="cyan"
        badge={{ label: "Passo 2", variant: "step" }}
      >
        <CalibrationPanel config={config} metrics={modelMetrics} snapshot={snapshot} accent="cyan" />
      </SettingsSection>

      <SettingsSection
        id="synopsis-canonical"
        title="Sinopse canônica"
        description="Consolida múltiplas sinopses por obra em uma única canônica via Haiku — usada nos prompts de recomendação."
        icon={<Brain />}
        accent="violet"
        badge={{ label: "Independente", variant: "independent" }}
      >
        <SynopsisConsolidationPanel
          accent="violet"
          pendingCount={canonicalSynopsisPending}
          totalCount={worksCount}
        />
        <div className="mt-4 border-t border-border/60 pt-4">
          <SynopsisCanonicalOnCreateToggle initialEnabled={synopsisCanonicalOnCreate} />
        </div>
      </SettingsSection>

      <SettingsSection
        id="review-summary"
        title="Resumo de reviews"
        description="Resume as reviews externas de cada obra em um parágrafo de consenso via Haiku — mostrado na aba Notas & Avaliações."
        icon={<Sparkles />}
        accent="amber"
        badge={{ label: "Independente", variant: "independent" }}
      >
        <ReviewSummaryPanel
          accent="amber"
          pendingCount={reviewSummaryPending}
          totalCount={worksCount}
        />
      </SettingsSection>

      <SettingsSection
        id="review-digest"
        title="Digest estruturado de reviews"
        description="Destila as reviews num digest estruturado (Sonnet) que o consultor IA consome — consenso, traços salientes, alertas. Opt-in (custo Sonnet)."
        icon={<Layers />}
        accent="amber"
        badge={{ label: "Independente", variant: "independent" }}
      >
        <ReviewDigestPanel accent="amber" />
      </SettingsSection>

      {/* ── Casos especiais ───────────────────────────────────────── */}
      <GroupHeading label="Casos especiais" />

      <SettingsSection
        id="sync"
        title="Sincronização de constantes"
        description="Regenera os arquivos locais de constantes a partir do Supabase. Só precisa quando o schema/tabelas de constantes do DB mudam."
        icon={<Database />}
        accent="indigo"
      >
        <SyncConstantsPanel initialLastRun={syncConstantsLastRun} accent="indigo" />
      </SettingsSection>

      <SettingsSection
        id="ai-calibration"
        title="Calibração de critérios IA"
        description="Auditoria por obra com auto-apply de sugestões e detecção de viés sistemático nos category_scores."
        icon={<Sparkles />}
        accent="rose"
      >
        <NavLink href="/settings/calibration" accent="rose" label="Abrir página de calibração" />
      </SettingsSection>

      <SettingsSection
        id="tags"
        title="Consolidação de tags"
        description="Revise clusters semânticos propostos pela IA e mescle tags duplicadas."
        icon={<Tags />}
        accent="fuchsia"
      >
        <NavLink href="/settings/tag-consolidation" accent="fuchsia" label="Abrir página de consolidação" />
      </SettingsSection>

      {/* ── Comix & criação ───────────────────────────────────────── */}
      <GroupHeading label="Comix & criação" />

      <SettingsSection
        id="comix-health"
        title="Diagnóstico da Comix"
        description="Testa se as chamadas pra Comix estão funcionando (FlareSolverr, detalhe, reviews, imagem) sem precisar abrir uma obra."
        icon={<Activity />}
        accent="slate"
      >
        <ComixHealthPanel accent="slate" />
      </SettingsSection>

      <SettingsSection
        id="comix"
        title="Cobertura da Comix"
        description="Resolve o hid da Comix das obras (pra habilitar reviews) e permite preencher manualmente as não encontradas. A Comix é a fonte principal de reviews."
        icon={<BookOpen />}
        accent="slate"
      >
        <ResolveComixPanel accent="slate" initialStatus={comixStatus} initialMissing={comixMissing} />
      </SettingsSection>

      <SettingsSection
        id="ai-on-create"
        title="Avaliação IA na criação"
        description="Controla se a avaliação IA roda automaticamente ao criar uma obra via Buscar dados. Desabilitada por padrão pra evitar custo de tokens não intencional."
        icon={<Sparkles />}
        accent="amber"
      >
        <AiEvalOnCreateToggle initialEnabled={aiEvalOnCreate} />
      </SettingsSection>

      <ScrollToTop />
    </div>
  )
}

function SettingsIndex() {
  return (
    <nav
      aria-label="Índice de configurações"
      className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-3 shadow-md shadow-black/5 sm:p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-foreground/10 text-foreground/70 [&_svg]:size-3.5">
          <Compass />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Ir para
        </p>
        <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
      </div>

      <div className="space-y-4">
        {SECTION_GROUPS.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              {group.label}
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {group.sections.map((section) => {
                const styles = ACCENT_STYLES[section.accent]
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left shadow-sm shadow-black/5 transition-all",
                      "hover:-translate-y-0.5 hover:shadow-md",
                      styles.cardBg,
                      styles.cardBorder,
                      styles.cardHoverBorder,
                      styles.cardHoverShadow
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-lg ring-1 transition-transform [&_svg]:size-[18px]",
                        styles.iconBg,
                        styles.iconText,
                        styles.ring,
                        "group-hover:scale-105"
                      )}
                    >
                      {section.icon}
                    </span>
                    <span className="min-w-0 text-sm font-semibold text-foreground">
                      {section.title}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}

function IndexSpacer() {
  return (
    <div className="relative my-2 flex items-center" aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border/55 to-transparent" />
    </div>
  )
}

type Accent = SettingsAccent

const ACCENT_STYLES: Record<
  Accent,
  {
    rail: string
    iconBg: string
    iconText: string
    ring: string
    cardBg: string
    cardBorder: string
    cardHoverBorder: string
    cardHoverShadow: string
  }
> = {
  cyan: {
    rail: "bg-gradient-to-b from-cyan-500/80 to-cyan-500/30",
    iconBg: "bg-cyan-500/20",
    iconText: "text-cyan-600 dark:text-cyan-300",
    ring: "ring-cyan-500/30",
    cardBg: "bg-cyan-500/15",
    cardBorder: "border-cyan-500/40",
    cardHoverBorder: "hover:border-cyan-500/70",
    cardHoverShadow: "hover:shadow-cyan-500/25",
  },
  violet: {
    rail: "bg-gradient-to-b from-violet-500/80 to-violet-500/30",
    iconBg: "bg-violet-500/20",
    iconText: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30",
    cardBg: "bg-violet-500/15",
    cardBorder: "border-violet-500/40",
    cardHoverBorder: "hover:border-violet-500/70",
    cardHoverShadow: "hover:shadow-violet-500/25",
  },
  emerald: {
    rail: "bg-gradient-to-b from-emerald-500/80 to-emerald-500/30",
    iconBg: "bg-emerald-500/20",
    iconText: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
    cardBg: "bg-emerald-500/15",
    cardBorder: "border-emerald-500/40",
    cardHoverBorder: "hover:border-emerald-500/70",
    cardHoverShadow: "hover:shadow-emerald-500/25",
  },
  slate: {
    rail: "bg-gradient-to-b from-slate-500/70 to-slate-500/20",
    iconBg: "bg-slate-500/20",
    iconText: "text-slate-500 dark:text-slate-300",
    ring: "ring-slate-500/30",
    cardBg: "bg-slate-500/15",
    cardBorder: "border-slate-500/40",
    cardHoverBorder: "hover:border-slate-500/70",
    cardHoverShadow: "hover:shadow-slate-500/20",
  },
  amber: {
    rail: "bg-gradient-to-b from-amber-500/80 to-amber-500/30",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/30",
    cardBg: "bg-amber-500/15",
    cardBorder: "border-amber-500/40",
    cardHoverBorder: "hover:border-amber-500/70",
    cardHoverShadow: "hover:shadow-amber-500/25",
  },
  indigo: {
    rail: "bg-gradient-to-b from-indigo-500/80 to-indigo-500/30",
    iconBg: "bg-indigo-500/20",
    iconText: "text-indigo-600 dark:text-indigo-300",
    ring: "ring-indigo-500/30",
    cardBg: "bg-indigo-500/15",
    cardBorder: "border-indigo-500/40",
    cardHoverBorder: "hover:border-indigo-500/70",
    cardHoverShadow: "hover:shadow-indigo-500/25",
  },
  rose: {
    rail: "bg-gradient-to-b from-rose-500/80 to-rose-500/30",
    iconBg: "bg-rose-500/20",
    iconText: "text-rose-600 dark:text-rose-300",
    ring: "ring-rose-500/30",
    cardBg: "bg-rose-500/15",
    cardBorder: "border-rose-500/40",
    cardHoverBorder: "hover:border-rose-500/70",
    cardHoverShadow: "hover:shadow-rose-500/25",
  },
  fuchsia: {
    rail: "bg-gradient-to-b from-fuchsia-500/80 to-fuchsia-500/30",
    iconBg: "bg-fuchsia-500/20",
    iconText: "text-fuchsia-600 dark:text-fuchsia-300",
    ring: "ring-fuchsia-500/30",
    cardBg: "bg-fuchsia-500/15",
    cardBorder: "border-fuchsia-500/40",
    cardHoverBorder: "hover:border-fuchsia-500/70",
    cardHoverShadow: "hover:shadow-fuchsia-500/25",
  },
}

type SectionBadge = { label: string; variant: "step" | "independent" }

function SettingsSection({
  id,
  title,
  description,
  icon,
  accent,
  badge,
  children,
}: {
  id?: string
  title: string
  description: string
  icon: ReactNode
  accent: Accent
  badge?: SectionBadge
  children: ReactNode
}) {
  const styles = ACCENT_STYLES[accent]
  return (
    <section
      id={id}
      className="relative scroll-mt-4 overflow-hidden rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5 backdrop-blur"
    >
      <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", styles.rail)} />
      <div className="space-y-4 px-4 py-4 pl-5 sm:px-5 sm:py-5 sm:pl-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-5",
              styles.iconBg,
              styles.iconText,
              styles.ring
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
              {badge && <SectionBadge badge={badge} accent={accent} />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}

function SectionBadge({ badge, accent }: { badge: SectionBadge; accent: Accent }) {
  const styles = ACCENT_STYLES[accent]
  if (badge.variant === "step") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
          styles.iconBg,
          styles.iconText,
          styles.ring
        )}
      >
        {badge.label}
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {badge.label}
    </span>
  )
}

function GroupHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-1 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
    </div>
  )
}

function RecommendedOrderBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
      <p>
        <span className="font-medium text-foreground">Ordem recomendada:</span> atualize os{" "}
        <span className="font-medium">Embeddings</span> (Passo 1) antes de{" "}
        <span className="font-medium">Recalibrar</span> (Passo 2) — a calibração usa o kNN derivado
        dos embeddings. <span className="font-medium">Sinopse canônica</span> e{" "}
        <span className="font-medium">Resumo de reviews</span> são independentes e podem rodar a
        qualquer momento.
      </p>
    </div>
  )
}

function NavLink({ href, accent, label }: { href: string; accent: Accent; label: string }) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        ACCENT_LINK[accent]
      )}
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </a>
  )
}
