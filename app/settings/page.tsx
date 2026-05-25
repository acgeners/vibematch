import type { ReactNode } from "react"
import { promises as fs } from "node:fs"
import path from "node:path"
import {
  Activity,
  ArrowRight,
  Brain,
  Compass,
  Database,
  Gauge,
  Settings,
  Sparkles,
  Tags,
} from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { WeightSuggestionsPanel } from "@/components/settings/weight-suggestions-panel"
import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { SynopsisConsolidationPanel } from "@/components/settings/synopsis-consolidation-panel"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
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
    weightsLastAppliedRes,
    syncConstantsLastRun,
    canonicalSynopsisPending,
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
    supabase
      .from("score_weights")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getSyncConstantsMtime(),
    supabase
      .from("works")
      .select("id", { count: "exact", head: true })
      .is("canonical_synopsis", null)
      .eq("is_archived", false)
      .then((r) => r.count ?? 0),
  ])

  if (configRes.error) throw new Error(configRes.error.message)
  if (!configRes.data?.[0]) throw new Error("formula_config não encontrado")

  return {
    config: configRes.data?.[0] as FormulaConfig,
    snapshot,
    embeddingsCount,
    worksCount,
    embeddingsLastRun: (embeddingsLastRunRes.data?.updated_at as string | undefined) ?? null,
    weightsLastApplied: (weightsLastAppliedRes.data?.updated_at as string | undefined) ?? null,
    syncConstantsLastRun,
    canonicalSynopsisPending,
  }
}

const SECTION_GROUPS = [
  {
    label: "Operação contínua",
    sections: [
      { id: "calibration", title: "Calibração", icon: <Gauge />, accent: "cyan" as const },
      { id: "embeddings", title: "Embeddings", icon: <Brain />, accent: "emerald" as const },
      { id: "synopsis-canonical", title: "Sinopse canônica", icon: <Brain />, accent: "violet" as const },
      { id: "ai-usage", title: "Uso da API IA", icon: <Activity />, accent: "cyan" as const },
      { id: "sync", title: "Sincronização", icon: <Database />, accent: "emerald" as const },
    ],
  },
  {
    label: "Manutenção periódica",
    sections: [
      { id: "weights", title: "Sugestão de pesos", icon: <Sparkles />, accent: "violet" as const },
      { id: "ai-calibration", title: "Calibração IA", icon: <Sparkles />, accent: "amber" as const },
      { id: "tags", title: "Consolidação de tags", icon: <Tags />, accent: "violet" as const },
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
    weightsLastApplied,
    syncConstantsLastRun,
    canonicalSynopsisPending,
  } = await getSettingsData()

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

      <SettingsSection
        id="calibration"
        title="Calibração automática"
        description="MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado."
        icon={<Gauge />}
        accent="cyan"
      >
        <CalibrationPanel config={config} snapshot={snapshot} />
      </SettingsSection>

      <SettingsSection
        id="embeddings"
        title="Embeddings das obras"
        description="Representação vetorial via OpenAI para 'obras parecidas' e kNN predictor. Cacheado por obra — só re-embeda quando sinopse/tags/critérios mudam."
        icon={<Brain />}
        accent="emerald"
      >
        <EmbeddingsPanel
          initialCachedCount={embeddingsCount}
          totalWorks={worksCount}
          initialLastRun={embeddingsLastRun}
        />
      </SettingsSection>

      <SettingsSection
        id="synopsis-canonical"
        title="Sinopse canônica"
        description="Consolida múltiplas sinopses por obra em uma única canônica via Haiku — usada nos prompts de recomendação."
        icon={<Brain />}
        accent="violet"
      >
        <SynopsisConsolidationPanel
          pendingCount={canonicalSynopsisPending}
          totalCount={worksCount}
        />
      </SettingsSection>

      <SettingsSection
        id="ai-usage"
        title="Uso da API IA"
        description="Custo estimado em USD, tokens consumidos e latência por operação/modelo. Consolidado de todas as chamadas Anthropic do app."
        icon={<Activity />}
        accent="cyan"
      >
        <a
          href="/settings/ai-usage"
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/55 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
        >
          Abrir página de uso
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </SettingsSection>

      <SettingsSection
        id="sync"
        title="Sincronização de constantes"
        description="Regenera os arquivos locais de constantes a partir do Supabase."
        icon={<Database />}
        accent="emerald"
      >
        <SyncConstantsPanel initialLastRun={syncConstantsLastRun} />
      </SettingsSection>

      <SettingsSection
        id="weights"
        title="Sugestão de pesos a partir do seu histórico"
        description="Treina uma regressão restrita aos 9 critérios contra suas notas reais e sugere pesos que minimizam o erro. Você revisa antes de aplicar."
        icon={<Sparkles />}
        accent="violet"
      >
        <WeightSuggestionsPanel initialLastApplied={weightsLastApplied} />
      </SettingsSection>

      <SettingsSection
        id="ai-calibration"
        title="Calibração de critérios IA"
        description="Auditoria por obra com auto-apply de sugestões e detecção de viés sistemático nos category_scores."
        icon={<Sparkles />}
        accent="amber"
      >
        <a
          href="/settings/calibration"
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/55 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
        >
          Abrir página de calibração
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </SettingsSection>

      <SettingsSection
        id="tags"
        title="Consolidação de tags"
        description="Revise clusters semânticos propostos pela IA e mescle tags duplicadas."
        icon={<Tags />}
        accent="violet"
      >
        <a
          href="/settings/tag-consolidation"
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/55 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
        >
          Abrir página de consolidação
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
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

type Accent = "cyan" | "violet" | "emerald" | "slate" | "amber"

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
}

function SettingsSection({
  id,
  title,
  description,
  icon,
  accent,
  children,
}: {
  id?: string
  title: string
  description: string
  icon: ReactNode
  accent: Accent
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
            <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}
