import {
  Brain,
  Droplets,
  Heart,
  Palette,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Trophy,
} from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getFilterPresets } from "@/server/queries/filter-presets"
import { getAllTags } from "@/server/queries/tags"
import { getTagPreferenceRows } from "@/server/queries/tag-preferences"
import { TagPreferencesForm } from "@/components/settings/tag-preferences-form"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { ScoreWeightsForm } from "@/components/settings/score-weights-form"
import { WeightSuggestionsPanel } from "@/components/settings/weight-suggestions-panel"
import { PostReadingWeightsForm } from "@/components/settings/post-reading-weights-form"
import { PostReadingWeightSuggestionsPanel } from "@/components/settings/post-reading-weight-suggestions-panel"
import { RankingPreferencesForm } from "@/components/settings/ranking-preferences-form"
import { SavedRankingFilters } from "@/components/settings/saved-ranking-filters"
import { ScoreColorPercentilesForm } from "@/components/settings/score-color-percentiles-form"
import { CriterionColorPercentilesForm } from "@/components/settings/criterion-color-percentiles-form"
import { AiEvalPreferencesForm } from "@/components/settings/ai-eval-preferences-form"
import {
  PreferencesAccordion,
  type PreferencesSection,
} from "@/components/settings/preferences-accordion"
import { PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM } from "@/lib/ai-evaluation/service"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

async function getPreferencesData() {
  const supabase = createAdminClient()

  const [weightsRes, configRes, weightsLastAppliedRes] = await Promise.all([
    supabase.from("score_weights").select("*").eq("is_active", true).order("display_order"),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    supabase
      .from("score_weights")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)
  if (!configRes.data?.[0]) throw new Error("formula_config não encontrado")

  return {
    weights: weightsRes.data as ScoreWeight[],
    config: configRes.data?.[0] as FormulaConfig,
    weightsLastApplied: (weightsLastAppliedRes.data?.updated_at as string | undefined) ?? null,
  }
}

export default async function PreferenciasPage() {
  const [{ weights, config, weightsLastApplied }, savedPresets, allTags, tagPrefRows] = await Promise.all([
    getPreferencesData(),
    getFilterPresets("/ranking"),
    getAllTags(),
    getTagPreferenceRows(),
  ])

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

  const sections: PreferencesSection[] = [
    {
      id: "ranking",
      title: "Filtros do Ranking",
      description: "Nº de obras exibidas, nota mínima padrão e seus filtros salvos.",
      icon: <Trophy />,
      accent: "primary",
      content: (
        <div className="space-y-4">
          <RankingPreferencesForm config={config} />
          <SavedRankingFilters presets={savedPresets} />
        </div>
      ),
    },
    {
      id: "tag-preferences",
      title: "Tags que amo / evito",
      description:
        "Declare gostos por grupo, subgrupo ou tag. Vira prior do seu perfil (ajusta o ranking) e habilita o filtro de evitadas.",
      icon: <Heart />,
      accent: "rose",
      content: <TagPreferencesForm tags={allTags} initialRows={tagPrefRows} />,
    },
    {
      id: "score-colors",
      title: "Cores das notas",
      description:
        "Percentis que definem as cores das notas agregadas (Nota Prevista / Nota.Calc).",
      icon: <Palette />,
      accent: "amber",
      content: <ScoreColorPercentilesForm config={config} />,
    },
    {
      id: "criterion-colors",
      title: "Cores dos atributos",
      description:
        "Percentis por atributo (opcional). Cada um colorido pela própria distribuição.",
      icon: <Droplets />,
      accent: "rose",
      content: <CriterionColorPercentilesForm config={config} />,
    },
    {
      id: "weights",
      title: "Pesos dos critérios",
      description: "Quanto cada critério IA vale na fórmula. Positivos amplificam, negativos penalizam.",
      icon: <Scale />,
      accent: "violet",
      content: autoActive ? (
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
      ),
    },
    {
      id: "post-reading",
      title: "Pesos pós-leitura",
      description: "Importância de cada eixo na sua avaliação manual (salva neste navegador).",
      icon: <Sparkles />,
      accent: "emerald",
      content: (
        <>
          <PostReadingWeightSuggestionsPanel />
          <div className="my-4 h-px bg-border/50" />
          <PostReadingWeightsForm />
        </>
      ),
    },
    {
      id: "ai-eval",
      title: "Avaliação IA",
      description: "Tolerância a versões antigas e threshold pra flagar avaliações de baixa confiança.",
      icon: <Brain />,
      accent: "cyan",
      content: (
        <AiEvalPreferencesForm
          config={config}
          currentPromptVersion={PROMPT_VERSION}
          currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        />
      ),
    },
  ]

  return (
    <div className="w-full max-w-6xl">
      <Header
        kicker="Você"
        title="Preferências"
        description="Ajuste o ranking, as cores das notas, os pesos e a avaliação por IA. Clique num card pra abrir."
        icon={<SlidersHorizontal />}
      />
      <PreferencesAccordion sections={sections} />
      <ScrollToTop />
    </div>
  )
}
