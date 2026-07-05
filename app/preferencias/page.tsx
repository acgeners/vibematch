import { Suspense } from "react"
import type { ReactNode } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { SettingsCard } from "@/components/settings/settings-card"
import { ACCENT_STYLES } from "@/components/console/console-registry"
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
import type { ScoreWeight, FormulaConfig } from "@/types/domain"
import type { SettingsSection } from "@/app/settings/sections"
import {
  PREFERENCES_DEFAULT_GROUP_ID,
  buildPreferencesGroups,
  findGroup,
  groupIdOfSection,
  normalizeGroupId,
} from "@/app/preferencias/sections"
import { cn } from "@/lib/utils"

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

const firstParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export default async function PreferenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string | string[]; s?: string | string[] }>
}) {
  const plan = await getCurrentPlan()
  const groups = buildPreferencesGroups(plan)
  const sp = await searchParams

  // `?g=` é a fonte; `?s=<item>` (deep-link antigo) resolve pro grupo dono.
  let groupId = normalizeGroupId(groups, sp.g)
  const legacy = firstParam(sp.s)
  if (!groupId && legacy) groupId = groupIdOfSection(groups, legacy)

  const group = findGroup(groups, groupId ?? PREFERENCES_DEFAULT_GROUP_ID) ?? groups[0]
  const accent = group.accent
  const s = ACCENT_STYLES[accent]
  const GroupIcon = group.icon
  // Itens do tópico ganham seta de colapso — exceto quando o tópico tem 1 só.
  const collapsible = group.sections.length > 1

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
        <span className="ml-auto shrink-0 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          {group.sections.length} {group.sections.length === 1 ? "item" : "itens"}
        </span>
      </header>

      <div className="space-y-4">
        {group.sections.map((section) => (
          <SettingsCard
            key={section.id}
            section={section}
            accent={accent}
            collapsible={collapsible}
            storageKeyPrefix="preferencias-card"
          >
            <Suspense fallback={<BodySkeleton />}>
              <ItemBody section={section} />
            </Suspense>
          </SettingsCard>
        ))}
      </div>

      <ScrollToTop />
    </div>
  )
}

// ── Corpo de cada card (lazy, streamado por <Suspense>) — busca só o próprio dado. ──
async function ItemBody({ section }: { section: SettingsSection }) {
  switch (section.id) {
    case "ranking": {
      const [config, savedPresets] = await Promise.all([
        getFormulaConfig(),
        getFilterPresets("/ranking"),
      ])
      return (
        <div className="space-y-4">
          <RankingPreferencesForm config={config} />
          <SavedRankingFilters presets={savedPresets} />
        </div>
      )
    }

    case "tag-preferences": {
      const [allTags, tagPrefRows] = await Promise.all([getAllTags(), getTagPreferenceRows()])
      return <TagPreferencesForm tags={allTags} initialRows={tagPrefRows} />
    }

    case "preference-rules": {
      // Só chega aqui no plano Pago (senão a seção nem entra no registry).
      const ruleRows = await getPreferenceRuleRows()
      return <PreferenceRulesForm initialRules={ruleRows} />
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

      // Com "pesos auto" ativo E inferência válida, exibimos os pesos inferidos (o
      // que vai pro IA(n)); os manuais ficam como fallback pra quando desativar.
      const autoActive = config.score_weights_auto && Boolean(config.score_weights_inferred)
      const effectiveWeights = autoActive
        ? weights.map((w) => {
            const suggestion = config.score_weights_inferred?.suggestions.find(
              (sg) => sg.slug === w.slug,
            )
            return suggestion ? { ...w, weight: suggestion.suggestedWeight } : w
          })
        : weights
      const confidenceBySlug: Record<string, "high" | "medium" | "low"> = {}
      if (autoActive && config.score_weights_inferred) {
        for (const sg of config.score_weights_inferred.suggestions) {
          confidenceBySlug[sg.slug] = sg.confidence
        }
      }

      return autoActive ? (
        <>
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
            <strong className="font-semibold">Pesos automáticos ativos</strong> (
            {config.score_weights_inferred?.trainSize ?? 0} obras com nota pessoal alimentaram a
            inferência). Os valores abaixo são os <strong>pesos inferidos via Ridge</strong> sobre
            seu histórico — usados no IA(n) em vez dos seus pesos manuais. Pra editar manualmente,
            desative o toggle em <code className="font-mono">/settings</code>.
          </div>
          <ScoreWeightsForm weights={effectiveWeights} readOnly confidenceBySlug={confidenceBySlug} />
        </>
      ) : (
        <>
          <WeightSuggestionsPanel initialLastApplied={weightsLastApplied} />
          <div className="my-4 h-px bg-border/50" />
          <ScoreWeightsForm weights={weights} />
        </>
      )
    }

    case "post-reading":
      return (
        <>
          <PostReadingWeightSuggestionsPanel />
          <div className="my-4 h-px bg-border/50" />
          <PostReadingWeightsForm />
        </>
      )

    case "score-colors": {
      const config = await getFormulaConfig()
      return <ScoreColorPercentilesForm config={config} />
    }

    case "criterion-colors": {
      const config = await getFormulaConfig()
      return <CriterionColorPercentilesForm config={config} />
    }

    default:
      return null
  }
}

function BodySkeleton(): ReactNode {
  return (
    <div className="space-y-2">
      <div className="h-9 w-full animate-pulse rounded bg-muted/60" />
      <div className="h-9 w-3/4 animate-pulse rounded bg-muted/60" />
    </div>
  )
}
