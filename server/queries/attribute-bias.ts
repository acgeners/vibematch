import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { BIAS_SHRINKAGE_K } from "@/lib/calculations/attribute-bias"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"

export interface AttributeBiasRow {
  attributeSlug: string
  attributeLabel: string
  nSamples: number
  meanBiasRaw: number
  biasApplied: number
  shrinkagePct: number
  stddev: number | null
}

export interface AttributeBiasOverview {
  totalAssessments: number
  assessedWorks: number
  rows: AttributeBiasRow[]
}

/**
 * Lê o estado do offset de atributos pra exibição em /curation/settings/calibration.
 * Junta attribute_bias com labels de CRITERIA_INFO. Atributos sem linha
 * aparecem zerados (ordem canônica de CRITERION_SLUGS).
 */
export async function getAttributeBiasOverview(): Promise<AttributeBiasOverview> {
  const supabase = createAdminClient()
  const userId = await getCurrentUserId(supabase)

  const [{ data: bias, error: biasErr }, { count: totalAssessments }, assessedWorks] =
    await Promise.all([
      supabase
        .from("attribute_bias")
        .select("attribute_slug, n_samples, mean_bias_raw, bias_applied, stddev_bias")
        .eq("user_id", userId),
      supabase
        .from("user_attribute_assessment")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("user_attribute_assessment")
        .select("work_id")
        .eq("user_id", userId)
        .then(({ data }) => new Set((data ?? []).map((r) => r.work_id)).size),
    ])

  if (biasErr) throw new Error(`Falha lendo attribute_bias: ${biasErr.message}`)

  const bySlug = new Map(
    (bias ?? []).map((r) => [r.attribute_slug, r]),
  )

  const rows: AttributeBiasRow[] = CRITERION_SLUGS.map((slug) => {
    const r = bySlug.get(slug)
    const n = r ? Number(r.n_samples) : 0
    return {
      attributeSlug: slug,
      attributeLabel: CRITERIA_INFO[slug]?.name ?? slug,
      nSamples: n,
      meanBiasRaw: r ? Number(r.mean_bias_raw) : 0,
      biasApplied: r ? Number(r.bias_applied) : 0,
      shrinkagePct: n > 0 ? Math.round((n / (n + BIAS_SHRINKAGE_K)) * 100) : 0,
      stddev: r?.stddev_bias == null ? null : Number(r.stddev_bias),
    }
  })

  return {
    totalAssessments: totalAssessments ?? 0,
    assessedWorks,
    rows,
  }
}
