import type { ReactNode } from "react"
import {
  Brain,
  Compass,
  Palette,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Trophy,
} from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { TasteProfileHealth } from "@/components/settings/taste-profile-health"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { ScoreWeightsForm } from "@/components/settings/score-weights-form"
import { WeightSuggestionsPanel } from "@/components/settings/weight-suggestions-panel"
import { PostReadingWeightsForm } from "@/components/settings/post-reading-weights-form"
import { PostReadingWeightSuggestionsPanel } from "@/components/settings/post-reading-weight-suggestions-panel"
import { RankingPreferencesForm } from "@/components/settings/ranking-preferences-form"
import { ScoreColorPercentilesForm } from "@/components/settings/score-color-percentiles-form"
import { AiEvalPreferencesForm } from "@/components/settings/ai-eval-preferences-form"
import { PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM } from "@/lib/ai-evaluation/service"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"
import { cn } from "@/lib/utils"

async function getPreferencesData() {
  const supabase = createAdminClient()

  const [weightsRes, configRes, weightsLastAppliedRes, tasteProfile] = await Promise.all([
    supabase.from("score_weights").select("*").eq("is_active", true).order("display_order"),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    supabase
      .from("score_weights")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadCurrentTasteProfile(),
  ])

  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)
  if (!configRes.data?.[0]) throw new Error("formula_config não encontrado")

  return {
    weights: weightsRes.data as ScoreWeight[],
    config: configRes.data?.[0] as FormulaConfig,
    weightsLastApplied: (weightsLastAppliedRes.data?.updated_at as string | undefined) ?? null,
    tasteProfile,
  }
}

const SECTIONS = [
  { id: "ranking", title: "Ranking", icon: <Trophy />, accent: "primary" as const },
  { id: "score-colors", title: "Cores das notas", icon: <Palette />, accent: "amber" as const },
  { id: "weights", title: "Pesos dos critérios", icon: <Scale />, accent: "violet" as const },
  { id: "post-reading", title: "Pesos pós-leitura", icon: <Sparkles />, accent: "emerald" as const },
  { id: "ai-eval", title: "Avaliação IA", icon: <Brain />, accent: "cyan" as const },
]

export default async function PreferencesPage() {
  const { weights, config, weightsLastApplied, tasteProfile } = await getPreferencesData()

  // Quando "pesos auto" está ativo E houve inferência válida, sobrescrevemos
  // os pesos exibidos com os inferidos — refletindo o que de fato vai ser usado
  // no IA(n). Pesos manuais persistidos não são tocados (ficam como fallback
  // pra quando o user desativar).
  const autoActive =
    config.score_weights_auto && Boolean(config.score_weights_inferred)
  const effectiveWeights = autoActive
    ? weights.map((w) => {
        const suggestion = config.score_weights_inferred?.suggestions.find(
          (s) => s.slug === w.slug,
        )
        return suggestion ? { ...w, weight: suggestion.suggestedWeight } : w
      })
    : weights
  const confidenceBySlug: Record<string, "high" | "medium" | "low"> = {}
  if (autoActive && config.score_weights_inferred) {
    for (const s of config.score_weights_inferred.suggestions) {
      confidenceBySlug[s.slug] = s.confidence
    }
  }

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Você"
        title="Preferências"
        description="Ajustes pessoais que controlam scoring, ranking e backlog de IA"
        icon={<SlidersHorizontal />}
      />

      <PrefIndex />

      <IndexSpacer />

      <TasteProfileHealth tasteProfile={tasteProfile} />

      <PrefSection
        id="ranking"
        title="Ranking"
        description="Quantas obras mostrar e quais notas mínimas aplicar por padrão."
        icon={<Trophy />}
        accent="primary"
      >
        <RankingPreferencesForm config={config} />
      </PrefSection>

      <PrefSection
        id="score-colors"
        title="Cores das notas"
        description="Percentis da distribuição que definem as cores de Nota.Final / Nota.IA / Nota.Pr."
        icon={<Palette />}
        accent="amber"
      >
        <ScoreColorPercentilesForm config={config} />
      </PrefSection>

      <PrefSection
        id="weights"
        title="Pesos dos critérios"
        description="Quanto cada critério IA vale na fórmula de scoring. Positivos amplificam, negativos penalizam."
        icon={<Scale />}
        accent="violet"
      >
        {autoActive ? (
          <>
            <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
              <strong className="font-semibold">Pesos automáticos ativos</strong> ({config.score_weights_inferred?.trainSize ?? 0} obras com nota pessoal alimentaram a inferência).
              Os valores abaixo são os <strong>pesos inferidos via Ridge</strong> sobre seu histórico — usados no IA(n) em vez dos seus pesos manuais.
              Pra editar manualmente, desative o toggle em <code className="font-mono">/settings</code>.
            </div>
            <ScoreWeightsForm
              weights={effectiveWeights}
              readOnly
              confidenceBySlug={confidenceBySlug}
            />
          </>
        ) : (
          <>
            <WeightSuggestionsPanel initialLastApplied={weightsLastApplied} />
            <div className="my-4 h-px bg-border/50" />
            <ScoreWeightsForm weights={weights} />
          </>
        )}
      </PrefSection>

      <PrefSection
        id="post-reading"
        title="Pesos pós-leitura"
        description="Importância relativa de cada eixo na sua avaliação manual (salva neste navegador)."
        icon={<Sparkles />}
        accent="emerald"
      >
        <PostReadingWeightSuggestionsPanel />
        <div className="my-4 h-px bg-border/50" />
        <PostReadingWeightsForm />
      </PrefSection>

      <PrefSection
        id="ai-eval"
        title="Avaliação IA"
        description="Tolerância a versões antigas e threshold para flagar avaliações de baixa confiança."
        icon={<Brain />}
        accent="cyan"
      >
        <AiEvalPreferencesForm
          config={config}
          currentPromptVersion={PROMPT_VERSION}
          currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        />
      </PrefSection>

      <ScrollToTop />
    </div>
  )
}

function PrefIndex() {
  return (
    <nav
      aria-label="Índice de preferências"
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

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {SECTIONS.map((section) => {
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
                  "grid size-10 shrink-0 place-items-center rounded-lg ring-1 transition-colors [&_svg]:size-[18px]",
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

type Accent = "primary" | "violet" | "emerald" | "cyan" | "amber"

const ACCENT_STYLES: Record<
  Accent,
  {
    rail: string
    iconBg: string
    iconText: string
    ring: string
    hoverBorder: string
    cardBg: string
    cardBorder: string
    cardHoverBorder: string
    cardHoverShadow: string
  }
> = {
  primary: {
    rail: "bg-gradient-to-b from-primary/80 to-primary/30",
    iconBg: "bg-primary/20",
    iconText: "text-primary",
    ring: "ring-primary/30",
    hoverBorder: "hover:border-primary/45",
    cardBg: "bg-primary/15",
    cardBorder: "border-primary/40",
    cardHoverBorder: "hover:border-primary/70",
    cardHoverShadow: "hover:shadow-primary/25",
  },
  violet: {
    rail: "bg-gradient-to-b from-violet-500/80 to-violet-500/30",
    iconBg: "bg-violet-500/20",
    iconText: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30",
    hoverBorder: "hover:border-violet-500/45",
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
    hoverBorder: "hover:border-emerald-500/45",
    cardBg: "bg-emerald-500/15",
    cardBorder: "border-emerald-500/40",
    cardHoverBorder: "hover:border-emerald-500/70",
    cardHoverShadow: "hover:shadow-emerald-500/25",
  },
  cyan: {
    rail: "bg-gradient-to-b from-cyan-500/80 to-cyan-500/30",
    iconBg: "bg-cyan-500/20",
    iconText: "text-cyan-600 dark:text-cyan-300",
    ring: "ring-cyan-500/30",
    hoverBorder: "hover:border-cyan-500/45",
    cardBg: "bg-cyan-500/15",
    cardBorder: "border-cyan-500/40",
    cardHoverBorder: "hover:border-cyan-500/70",
    cardHoverShadow: "hover:shadow-cyan-500/25",
  },
  amber: {
    rail: "bg-gradient-to-b from-amber-500/80 to-amber-500/30",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/30",
    hoverBorder: "hover:border-amber-500/45",
    cardBg: "bg-amber-500/15",
    cardBorder: "border-amber-500/40",
    cardHoverBorder: "hover:border-amber-500/70",
    cardHoverShadow: "hover:shadow-amber-500/25",
  },
}

function PrefSection({
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
