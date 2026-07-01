import type { ReactNode } from "react"
import { promises as fs } from "node:fs"
import path from "node:path"
import {
  ArrowRight,
  BookOpen,
  Brain,
  ChevronDown,
  Compass,
  Database,
  FileText,
  Gauge,
  Info,
  Layers,
  MessageSquareText,
  Settings,
  Sparkles,
  Tags,
  Wand2,
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
import { GroupInfoTooltip } from "@/components/settings/group-info-tooltip"
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

// Grupos por NATUREZA (não por tópico vago), ordenados por frequência de uso.
// 1 accent por grupo — cor vira hierarquia, não decoração por-item.
const SECTION_GROUPS: {
  label: string
  sections: { id: string; title: string; icon: ReactNode; accent: SettingsAccent }[]
}[] = [
  {
    label: "Calibração das notas",
    sections: [
      { id: "calibration", title: "Calibração automática", icon: <Gauge />, accent: "violet" },
      { id: "ai-calibration", title: "Calibração de critérios IA", icon: <Sparkles />, accent: "violet" },
    ],
  },
  {
    label: "Gerado por IA",
    sections: [
      { id: "embeddings", title: "Embeddings", icon: <Brain />, accent: "cyan" },
      { id: "synopsis-canonical", title: "Sinopse canônica", icon: <FileText />, accent: "cyan" },
      { id: "review-summary", title: "Resumo de reviews", icon: <MessageSquareText />, accent: "cyan" },
      { id: "review-digest", title: "Digest de reviews", icon: <Layers />, accent: "cyan" },
      { id: "on-create", title: "Comportamento na criação", icon: <Wand2 />, accent: "cyan" },
    ],
  },
  {
    label: "Fontes externas (Comix)",
    sections: [{ id: "comix", title: "Comix", icon: <BookOpen />, accent: "amber" }],
  },
  {
    label: "Avançado / manutenção",
    sections: [
      { id: "tags", title: "Consolidação de tags", icon: <Tags />, accent: "slate" },
      { id: "sync", title: "Sincronização de constantes", icon: <Database />, accent: "slate" },
    ],
  },
]

// Explicação de cada grupo (mostrada na tooltip do cabeçalho e do índice).
const GROUP_INFO: Record<string, string> = {
  "Gerado por IA":
    "Artefatos que a IA produz e guarda por obra — embeddings (OpenAI), sinopse canônica, resumo e digest de reviews (Claude). Regeneram sozinhos quando sinopse, tags ou critérios mudam. Rode-os após adicionar ou alterar obras; consomem tokens.",
  "Calibração das notas":
    "Ajusta a acurácia das notas previstas. A calibração automática recalcula MAEs e pseudo-votos (roda sozinha ao salvar uma obra); a de critérios IA audita e corrige vieses nos category_scores. Atualize os embeddings antes.",
  "Fontes externas (Comix)":
    "Operação da Comix, a principal fonte de reviews. Resolve o hid das obras (habilita a coleta de reviews) e testa a conexão. Use quando obras novas estão sem reviews.",
  "Avançado / manutenção":
    "Tarefas raras de manutenção: consolidar/mesclar tags duplicadas e regenerar os arquivos de constantes a partir do banco (só quando o schema do DB muda). Recolhido por padrão.",
}

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
        description="Console de operação: jobs do pipeline, curadoria e manutenção"
        icon={<Settings />}
      />

      <SettingsIndex
        pending={{
          embeddings: embeddingsPending,
          "synopsis-canonical": canonicalSynopsisPending,
          "review-summary": reviewSummaryPending,
          comix: comixMissing.length,
        }}
      />

      <IndexSpacer />

      {/* ── Calibração das notas ───────────────────────────────────── */}
      <GroupHeading label="Calibração das notas" hint="acurácia das notas previstas" />
      <SectionNote accent="violet">
        A calibração usa o kNN dos <span className="font-medium text-foreground">Embeddings</span> —
        atualize-os (Passo 1, grupo abaixo) antes de recalibrar (Passo 2).
      </SectionNote>

      <SettingsSection
        id="calibration"
        title="Calibração automática"
        description="MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado."
        icon={<Gauge />}
        accent="violet"
        chips={[
          { kind: "step", label: "Passo 2" },
          { kind: "cost", tier: "free", label: "Grátis" },
        ]}
      >
        <CalibrationPanel
          config={config}
          metrics={modelMetrics}
          snapshot={snapshot}
          accent="violet"
          aiPending={[
            { label: "Embeddings", count: embeddingsPending, href: "#embeddings" },
            { label: "Sinopse canônica", count: canonicalSynopsisPending, href: "#synopsis-canonical" },
            { label: "Resumo de reviews", count: reviewSummaryPending, href: "#review-summary" },
          ]}
        />
      </SettingsSection>

      <SettingsSection
        id="ai-calibration"
        title="Calibração de critérios IA"
        description="Auditoria por obra com auto-apply de sugestões e detecção de viés sistemático nos category_scores."
        icon={<Sparkles />}
        accent="violet"
        chips={[{ kind: "cadence", label: "Frequente" }]}
      >
        <NavLink href="/settings/calibration" accent="violet" label="Abrir página de calibração" />
      </SettingsSection>

      {/* ── Gerado por IA ─────────────────────────────────────────── */}
      <GroupHeading label="Gerado por IA" hint="derivados por modelo, cacheados por obra" />
      <SectionNote accent="cyan">
        Artefatos produzidos por modelo (OpenAI/Claude) e cacheados por obra — só regeneram quando
        sinopse, tags ou critérios mudam. Custam tokens.
      </SectionNote>

      <SettingsSection
        id="embeddings"
        title="Embeddings das obras"
        description="Representação vetorial via OpenAI para 'obras parecidas' e kNN predictor. Cacheado por obra — só re-embeda quando sinopse/tags/critérios mudam."
        icon={<Brain />}
        accent="cyan"
        chips={[
          { kind: "step", label: "Passo 1" },
          { kind: "cost", tier: "low", label: "OpenAI ~$" },
        ]}
      >
        <EmbeddingsPanel
          accent="cyan"
          initialCachedCount={embeddingsCount}
          initialPendingCount={embeddingsPending}
          totalWorks={worksCount}
          initialLastRun={embeddingsLastRun}
        />
      </SettingsSection>

      <SettingsSection
        id="synopsis-canonical"
        title="Sinopse canônica"
        description="Consolida múltiplas sinopses por obra em uma única canônica via Haiku — usada nos prompts de recomendação."
        icon={<FileText />}
        accent="cyan"
        chips={[
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
        ]}
      >
        <SynopsisConsolidationPanel
          accent="cyan"
          pendingCount={canonicalSynopsisPending}
          totalCount={worksCount}
        />
      </SettingsSection>

      <SettingsSection
        id="review-summary"
        title="Resumo de reviews"
        description="Resume as reviews externas de cada obra em um parágrafo de consenso via Haiku — mostrado na aba Notas & Avaliações."
        icon={<MessageSquareText />}
        accent="cyan"
        chips={[
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
        ]}
      >
        <ReviewSummaryPanel accent="cyan" pendingCount={reviewSummaryPending} totalCount={worksCount} />
      </SettingsSection>

      <SettingsSection
        id="review-digest"
        title="Digest estruturado de reviews"
        description="Destila as reviews num digest estruturado (Sonnet) que o consultor IA consome — consenso, traços salientes, alertas. Opt-in (custo Sonnet)."
        icon={<Layers />}
        accent="cyan"
        chips={[
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "high", label: "Sonnet $$" },
        ]}
      >
        <ReviewDigestPanel accent="cyan" />
      </SettingsSection>

      <SettingsSection
        id="on-create"
        title="Comportamento na criação"
        description="O que roda automaticamente ao criar uma obra via 'Buscar dados'. Desligado por padrão pra evitar custo de tokens não intencional."
        icon={<Wand2 />}
        accent="cyan"
        chips={[{ kind: "cadence", label: "Preferência" }]}
      >
        <div className="divide-y divide-border/60">
          <div className="pb-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Avaliação IA</p>
            <AiEvalOnCreateToggle initialEnabled={aiEvalOnCreate} />
          </div>
          <div className="pt-4">
            <p className="mb-1.5 text-sm font-semibold text-foreground">Sinopse canônica</p>
            <SynopsisCanonicalOnCreateToggle initialEnabled={synopsisCanonicalOnCreate} />
          </div>
        </div>
      </SettingsSection>

      {/* ── Fontes externas (Comix) ────────────────────────────────── */}
      <GroupHeading label="Fontes externas (Comix)" hint="a principal fonte de reviews" />

      <SettingsSection
        id="comix"
        title="Comix"
        description="A fonte principal de reviews. Resolve o hid das obras (pra habilitar reviews), permite preencher manualmente as não encontradas e testar a conexão."
        icon={<BookOpen />}
        accent="amber"
        chips={[{ kind: "cadence", label: "Quando faltam reviews" }]}
      >
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Cobertura</p>
            <ResolveComixPanel accent="amber" initialStatus={comixStatus} initialMissing={comixMissing} />
          </div>
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-sm font-semibold text-foreground">Diagnóstico</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Testa se as chamadas pra Comix estão funcionando (FlareSolverr, detalhe, reviews,
              imagem) sem precisar abrir uma obra.
            </p>
            <ComixHealthPanel accent="amber" />
          </div>
        </div>
      </SettingsSection>

      {/* ── Avançado / manutenção (recolhido) ──────────────────────── */}
      <details className="group/adv mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-1 pt-2 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground transition-transform group-open/adv:rotate-0" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Avançado / manutenção
          </p>
          <GroupInfoTooltip text={GROUP_INFO["Avançado / manutenção"]} />
          <span className="ml-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            raro
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
        </summary>

        <div className="mt-4 space-y-4">
          <SettingsSection
            id="tags"
            title="Consolidação de tags"
            description="Revise clusters semânticos propostos pela IA e mescle tags duplicadas."
            icon={<Tags />}
            accent="slate"
            chips={[{ kind: "cadence", label: "Ocasional" }]}
          >
            <NavLink href="/settings/tag-consolidation" accent="slate" label="Abrir página de consolidação" />
          </SettingsSection>

          <SettingsSection
            id="sync"
            title="Sincronização de constantes"
            description="Regenera os arquivos locais de constantes a partir do Supabase. Só precisa quando o schema/tabelas de constantes do DB mudam."
            icon={<Database />}
            accent="slate"
            chips={[{ kind: "cadence", label: "Raro · dev" }]}
          >
            <SyncConstantsPanel initialLastRun={syncConstantsLastRun} accent="slate" />
          </SettingsSection>
        </div>
      </details>

      <ScrollToTop />
    </div>
  )
}

function SettingsIndex({ pending }: { pending: Record<string, number> }) {
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
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                {group.label}
              </p>
              {GROUP_INFO[group.label] && <GroupInfoTooltip text={GROUP_INFO[group.label]} />}
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {group.sections.map((section) => {
                const styles = ACCENT_STYLES[section.accent]
                const pendingCount = pending[section.id] ?? 0
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
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {section.title}
                    </span>
                    {pendingCount > 0 && (
                      <span
                        aria-label={`${pendingCount} ${pendingCount === 1 ? "item pendente" : "itens pendentes"}`}
                        className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-white/15"
                      >
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    )}
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

// Chips do cabeçalho da seção: cadência (quando rodar) + custo (token/$).
// Custo usa cor semântica (verde→grátis, âmbar→barato, rosa→caro), independente
// do accent do grupo — vira um "semáforo" de custo legível de cara.
type Chip =
  | { kind: "step"; label: string }
  | { kind: "cadence"; label: string }
  | { kind: "cost"; tier: "free" | "low" | "high"; label: string }

const COST_TIER_STYLES: Record<"free" | "low" | "high", string> = {
  free: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  low: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  high: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
}

function SectionChips({ chips, accent }: { chips: Chip[]; accent: Accent }) {
  const styles = ACCENT_STYLES[accent]
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {chips.map((chip, i) => {
        if (chip.kind === "step") {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                styles.iconBg,
                styles.iconText,
                styles.ring
              )}
            >
              {chip.label}
            </span>
          )
        }
        if (chip.kind === "cost") {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                COST_TIER_STYLES[chip.tier]
              )}
            >
              {chip.label}
            </span>
          )
        }
        return (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {chip.label}
          </span>
        )
      })}
    </div>
  )
}

function SettingsSection({
  id,
  title,
  description,
  icon,
  accent,
  chips,
  children,
}: {
  id?: string
  title: string
  description: string
  icon: ReactNode
  accent: Accent
  chips?: Chip[]
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
            {chips && chips.length > 0 && <SectionChips chips={chips} accent={accent} />}
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}

function GroupHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      {GROUP_INFO[label] && <GroupInfoTooltip text={GROUP_INFO[label]} />}
      {hint && (
        <span className="ml-1 text-[10px] lowercase tracking-wide text-muted-foreground/60">
          {hint}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
    </div>
  )
}

const NOTE_ACCENT: Record<Accent, string> = {
  cyan: "border-cyan-500/30 bg-cyan-500/5",
  violet: "border-violet-500/30 bg-violet-500/5",
  emerald: "border-emerald-500/30 bg-emerald-500/5",
  slate: "border-slate-500/30 bg-slate-500/5",
  amber: "border-amber-500/30 bg-amber-500/5",
  indigo: "border-indigo-500/30 bg-indigo-500/5",
  rose: "border-rose-500/30 bg-rose-500/5",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/5",
}

function SectionNote({ accent, children }: { accent: Accent; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground",
        NOTE_ACCENT[accent]
      )}
    >
      <Info className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", ACCENT_STYLES[accent].iconText)} />
      <p>{children}</p>
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
