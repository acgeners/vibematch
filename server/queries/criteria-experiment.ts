import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchRecalcWorks } from "@/server/queries/recalc-works"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { EXPERIMENTAL_EXTRA, type ExperimentWork } from "@/lib/model-metrics/criteria-experiment"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

/**
 * A metade de I/O do harness `/curation/model-metrics/criteria-experiment`.
 *
 * 🔴 SOMENTE SELECT. Não há nenhum `insert`/`update`/`upsert`/`delete` neste módulo, e o
 * cálculo vem de `computeRecalc`, que é função PURA (não lê nem escreve banco) — quem persiste
 * é `recalculateAll`, que NÃO é chamado aqui. O teste
 * `tests/unit/orchestration/experimento-nao-escreve.test.ts` varre a árvore de imports inteira.
 */

/** Antes da migration 198 os dois critérios não existem — a página precisa saber sem 500. */
export async function experimentoDisponivel(): Promise<{
  disponivel: boolean
  faltando: string[]
}> {
  const sb = createAdminClient()
  const { data, error } = await sb.from("criteria").select("slug").eq("eval_type", "IA")
  // Não conseguir LER não é "disponível": devolve indisponível nomeando o motivo, nunca
  // deixa a página seguir e estourar mais adiante.
  if (error) return { disponivel: false, faltando: [...EXPERIMENTAL_EXTRA] }
  const noBanco = new Set((data ?? []).map((c) => c.slug))
  const faltando = EXPERIMENTAL_EXTRA.filter((s) => !noBanco.has(s))
  return { disponivel: faltando.length === 0, faltando }
}

/**
 * As obras ROTULADAS com o vetor de features já derivado pelo pipeline real.
 *
 * ⚠️ Passa por `computeRecalc` de propósito: é ele que produz `categoryScoresCalibrated`,
 * `iaEvalNormalizedCalibrated` e `criterionFitScore`. Recalcular isso aqui seria uma segunda
 * implementação do mesmo cálculo — a família de defeito que este projeto mais paga.
 *
 * ⚠️ Herda a guarda de contrato do `computeRecalc`: em estado misto (deploy sem a 198) ele
 * ABORTA, e o harness não roda. Correto — comparar 9 × 11 sobre um cálculo híbrido mediria o
 * estado da implantação, não os critérios.
 */
export async function carregarObrasDoExperimento(): Promise<ExperimentWork[]> {
  const sb = createAdminClient()
  const ownerId = await getOwnerUserId(sb)
  const biasMap = await getBiasMap(ownerId, sb)
  const [rawRows, weightsRes, configRes, tasteProfile, declaredTagPrefs, ownerLabels] =
    await Promise.all([
      fetchRecalcWorks(sb),
      sb.from("score_weights").select("*").eq("is_active", true),
      sb.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
      loadCurrentTasteProfile(ownerId),
      getDeclaredTagPreferences(sb, { headless: true }),
      loadOwnerLabels(),
    ])

  const raw = withOwnerLabels(rawRows as (RawWork & { title?: string })[], ownerLabels)
  const works = raw.map((r) => buildWork(r, biasMap))
  computeRecalc({
    works,
    weights: (weightsRes.data ?? []) as ScoreWeight[],
    config: configRes.data?.[0] as FormulaConfig,
    tasteProfile,
    declaredTagPrefs,
    includeQuality: false,
    aiQualityByWork: new Map(),
    fast: true,
  })

  // `source` por critério — o harness precisa distinguir nota REAL de seed `legacy_split_copy`.
  const sourcePorObra = new Map<string, Record<string, string | undefined>>()
  for (const r of rawRows as Array<{ id: string; category_scores?: Array<{ criterion_slug: string; source: string | null }> }>) {
    sourcePorObra.set(
      r.id,
      Object.fromEntries((r.category_scores ?? []).map((c) => [c.criterion_slug, c.source ?? "imported"])),
    )
  }

  return works
    .filter((w) => w.userScore != null)
    .map((w) => ({
      id: w.id,
      userScore: w.userScore as number,
      sources: sourcePorObra.get(w.id) ?? {},
      input: {
        categoryScores: w.categoryScoresCalibrated,
        iaEvalNormalized: w.iaEvalNormalizedCalibrated,
        platformAvg: w.platformAvg,
        totalVotes: w.totalVotes,
        totalChapters: w.totalChapters,
        synopsisQuality: w.synopsisQuality,
        observationAdjustment: w.observationAdjustment,
        publicationStatus: w.publicationStatus,
        lovedTagOverlap: w.lovedTagOverlap,
        avoidedTagOverlap: w.avoidedTagOverlap,
        criterionFitScore: w.criterionFitScore,
        releaseAge: w.releaseAge,
        runLength: w.runLength,
        origin: w.origin,
        postScores: w.postScores,
      },
    }))
}
