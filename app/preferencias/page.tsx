import { Suspense } from "react"
import {
  Brain,
  Droplets,
  Heart,
  Palette,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wand2,
} from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { ConsoleShell } from "@/components/console/console-shell"
import { ConsolePanelSkeleton, ConsoleSectionShell } from "@/components/console/console-section"
import { findSection, normalizeSectionId } from "@/components/console/console-registry"
import type { ConsoleGroup, ConsoleSection } from "@/components/console/console-registry"
import { getCurrentPlan } from "@/server/queries/current-user"
import { getFilterPresets } from "@/server/queries/filter-presets"
import { getAllTags } from "@/server/queries/tags"
import { getTagPreferenceRows } from "@/server/queries/tag-preferences"
import { getPreferenceRuleRows } from "@/server/queries/preference-rules"
import { TagPreferencesForm } from "@/components/settings/tag-preferences-form"
import { PreferenceRulesForm } from "@/components/settings/preference-rules-form"
import { ScoreWeightsForm } from "@/components/settings/score-weights-form"
import { WeightSuggestionsPanel } from "@/components/settings/weight-suggestions-panel"
import { PostReadingWeightsForm } from "@/components/settings/post-reading-weights-form"
import { PostReadingWeightSuggestionsPanel } from "@/components/settings/post-reading-weight-suggestions-panel"
import { RankingPreferencesForm } from "@/components/settings/ranking-preferences-form"
import { SavedRankingFilters } from "@/components/settings/saved-ranking-filters"
import { ScoreColorPercentilesForm } from "@/components/settings/score-color-percentiles-form"
import { CriterionColorPercentilesForm } from "@/components/settings/criterion-color-percentiles-form"
import { AiEvalPreferencesForm } from "@/components/settings/ai-eval-preferences-form"
import { PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM } from "@/lib/ai-evaluation/service"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

// Registry das preferências pro console (drill-in card-grid). É montado por
// request porque a seção "Regras livres (IA)" só existe no plano Pago.
function buildPreferencesGroups(plan: string): ConsoleGroup[] {
  const iaSections: ConsoleSection[] = []
  if (plan === "paid") {
    iaSections.push({
      id: "preference-rules",
      title: "Regras e preferências livres (IA)",
      description:
        "Orientações em texto livre pro consultor IA (Recomendar / Deep Dive / Desempatar / Chat). Não altera o ranking padrão.",
      icon: Wand2,
      accent: "cyan",
    })
  }
  iaSections.push({
    id: "ai-eval",
    title: "Avaliação IA",
    description:
      "Tolerância a versões antigas e threshold pra flagar avaliações de baixa confiança.",
    icon: Brain,
    accent: "cyan",
  })

  return [
    {
      label: "Ranking & gostos",
      hint: "o que molda as recomendações",
      info: "Ajusta como o ranking é montado e declara seus gostos. Os filtros definem o que aparece; as tags amadas/evitadas viram prior do seu perfil e habilitam o filtro de evitadas.",
      sections: [
        {
          id: "ranking",
          title: "Filtros do Ranking",
          description: "Nº de obras exibidas, nota mínima padrão e seus filtros salvos.",
          icon: Trophy,
          accent: "indigo",
        },
        {
          id: "tag-preferences",
          title: "Tags que amo / evito",
          description:
            "Declare gostos por grupo, subgrupo ou tag. Vira prior do seu perfil (ajusta o ranking) e habilita o filtro de evitadas.",
          icon: Heart,
          accent: "indigo",
        },
      ],
    },
    {
      label: "Pesos",
      hint: "importância de cada critério",
      info: "Quanto cada eixo pesa. Os pesos dos critérios entram na fórmula da IA; os pesos pós-leitura ponderam sua avaliação manual.",
      sections: [
        {
          id: "weights",
          title: "Pesos dos critérios",
          description:
            "Quanto cada critério IA vale na fórmula. Positivos amplificam, negativos penalizam.",
          icon: Scale,
          accent: "violet",
        },
        {
          id: "post-reading",
          title: "Pesos pós-leitura",
          description:
            "Importância de cada eixo na sua avaliação manual (salva neste navegador).",
          icon: Sparkles,
          accent: "violet",
        },
      ],
    },
    {
      label: "Cores",
      hint: "percentis das notas e atributos",
      info: "Percentis que definem as faixas de cor. Ajuste pra que verde/amarelo/vermelho reflitam o que você considera bom/médio/ruim.",
      stripRow: 2,
      sections: [
        {
          id: "score-colors",
          title: "Cores das notas",
          description:
            "Percentis que definem as cores das notas agregadas (Nota Prevista / Nota.Calc).",
          icon: Palette,
          accent: "amber",
        },
        {
          id: "criterion-colors",
          title: "Cores dos atributos",
          description:
            "Percentis por atributo (opcional). Cada um colorido pela própria distribuição.",
          icon: Droplets,
          accent: "amber",
        },
      ],
    },
    {
      label: "Avaliação por IA",
      hint: "tolerância e regras livres",
      info: "Como a IA avalia e recomenda pra você. A avaliação define tolerância a versões antigas e confiança; as regras livres (Pago) orientam o consultor em texto livre.",
      stripRow: 2,
      sections: iaSections,
    },
  ]
}

async function getFormulaConfig(): Promise<FormulaConfig> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("formula_config")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const config = data?.[0] as FormulaConfig | undefined
  if (!config) throw new Error("formula_config não encontrado")
  return config
}

export default async function PreferenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[] }>
}) {
  const plan = await getCurrentPlan()
  const groups = buildPreferencesGroups(plan)
  const sp = await searchParams
  const explicit = normalizeSectionId(groups, sp.s)

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Você"
        title="Preferências"
        description="Ajuste o ranking, os pesos, as cores das notas e a avaliação por IA."
        icon={<SlidersHorizontal />}
      />

      <ConsoleShell groups={groups} basePath="/preferencias" explicit={explicit} badges={{}}>
        {explicit && (
          <Suspense
            key={explicit}
            fallback={<ConsolePanelSkeleton section={findSection(groups, explicit)} />}
          >
            <PreferencesPanel section={explicit} groups={groups} />
          </Suspense>
        )}
      </ConsoleShell>

      <ScrollToTop />
    </div>
  )
}

// Switch de painéis (server) — renderiza SÓ o painel ativo e busca só o dado dele.
async function PreferencesPanel({
  section,
  groups,
}: {
  section: string
  groups: ConsoleGroup[]
}) {
  const meta = findSection(groups, section)
  if (!meta) return null

  switch (section) {
    case "ranking": {
      const [config, savedPresets] = await Promise.all([
        getFormulaConfig(),
        getFilterPresets("/ranking"),
      ])
      return (
        <ConsoleSectionShell section={meta}>
          <div className="space-y-4">
            <RankingPreferencesForm config={config} />
            <SavedRankingFilters presets={savedPresets} />
          </div>
        </ConsoleSectionShell>
      )
    }

    case "tag-preferences": {
      const [allTags, tagPrefRows] = await Promise.all([getAllTags(), getTagPreferenceRows()])
      return (
        <ConsoleSectionShell section={meta}>
          <TagPreferencesForm tags={allTags} initialRows={tagPrefRows} />
        </ConsoleSectionShell>
      )
    }

    case "preference-rules": {
      // Só chega aqui no plano Pago (senão a seção nem entra no registry).
      const ruleRows = await getPreferenceRuleRows()
      return (
        <ConsoleSectionShell section={meta}>
          <PreferenceRulesForm initialRules={ruleRows} />
        </ConsoleSectionShell>
      )
    }

    case "weights": {
      const supabase = createAdminClient()
      const [weightsRes, config, lastAppliedRes] = await Promise.all([
        supabase.from("score_weights").select("*").eq("is_active", true).order("display_order"),
        getFormulaConfig(),
        supabase
          .from("score_weights")
          .select("updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (weightsRes.error) throw new Error(weightsRes.error.message)
      const weights = weightsRes.data as ScoreWeight[]
      const weightsLastApplied = (lastAppliedRes.data?.updated_at as string | undefined) ?? null

      // Quando "pesos auto" está ativo E houve inferência válida, exibimos os
      // pesos inferidos (o que de fato vai pro IA(n)); os manuais ficam como
      // fallback pra quando o user desativar.
      const autoActive = config.score_weights_auto && Boolean(config.score_weights_inferred)
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
        <ConsoleSectionShell section={meta}>
          {autoActive ? (
            <>
              <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <strong className="font-semibold">Pesos automáticos ativos</strong> (
                {config.score_weights_inferred?.trainSize ?? 0} obras com nota pessoal alimentaram a
                inferência). Os valores abaixo são os{" "}
                <strong>pesos inferidos via Ridge</strong> sobre seu histórico — usados no IA(n) em
                vez dos seus pesos manuais. Pra editar manualmente, desative o toggle em{" "}
                <code className="font-mono">/settings</code>.
              </div>
              <ScoreWeightsForm weights={effectiveWeights} readOnly confidenceBySlug={confidenceBySlug} />
            </>
          ) : (
            <>
              <WeightSuggestionsPanel initialLastApplied={weightsLastApplied} />
              <div className="my-4 h-px bg-border/50" />
              <ScoreWeightsForm weights={weights} />
            </>
          )}
        </ConsoleSectionShell>
      )
    }

    case "post-reading":
      return (
        <ConsoleSectionShell section={meta}>
          <PostReadingWeightSuggestionsPanel />
          <div className="my-4 h-px bg-border/50" />
          <PostReadingWeightsForm />
        </ConsoleSectionShell>
      )

    case "score-colors": {
      const config = await getFormulaConfig()
      return (
        <ConsoleSectionShell section={meta}>
          <ScoreColorPercentilesForm config={config} />
        </ConsoleSectionShell>
      )
    }

    case "criterion-colors": {
      const config = await getFormulaConfig()
      return (
        <ConsoleSectionShell section={meta}>
          <CriterionColorPercentilesForm config={config} />
        </ConsoleSectionShell>
      )
    }

    case "ai-eval": {
      const config = await getFormulaConfig()
      return (
        <ConsoleSectionShell section={meta}>
          <AiEvalPreferencesForm
            config={config}
            currentPromptVersion={PROMPT_VERSION}
            currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
          />
        </ConsoleSectionShell>
      )
    }

    default:
      return null
  }
}
