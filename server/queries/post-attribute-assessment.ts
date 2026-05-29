import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"

type AdminClient = ReturnType<typeof createAdminClient>

export interface LatestAiEvaluationAttributes {
  evaluationId: string
  modelName: string
  promptVersion: string
  attributes: Record<CriterionSlug, number>
}

const SLUG_SET = new Set<string>(CRITERION_SLUGS)

/**
 * Última avaliação IA completed da obra + as notas sugeridas dos 9
 * atributos. Retorna null se a obra nunca foi avaliada (UI desabilita o
 * questionário nesse caso). Atributos sem suggested_score são omitidos.
 */
export async function getLatestAiEvaluationAttributes(
  workId: string,
  admin?: AdminClient,
): Promise<LatestAiEvaluationAttributes | null> {
  const supabase = admin ?? createAdminClient()
  const { data, error } = await supabase
    .from("ai_evaluations")
    .select("id, model_name, prompt_version, ai_evaluation_scores(criterion_slug, suggested_score)")
    .eq("work_id", workId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Falha lendo ai_evaluations: ${error.message}`)
  if (!data) return null

  const attributes = {} as Record<CriterionSlug, number>
  const scores = (data.ai_evaluation_scores as
    | Array<{ criterion_slug: string; suggested_score: number | string | null }>
    | null) ?? []
  for (const s of scores) {
    if (!SLUG_SET.has(s.criterion_slug) || s.suggested_score == null) continue
    attributes[s.criterion_slug as CriterionSlug] = Number(s.suggested_score)
  }

  return {
    evaluationId: data.id as string,
    modelName: (data.model_name as string | null) ?? "unknown",
    promptVersion: (data.prompt_version as string | null) ?? "unknown",
    attributes,
  }
}

/**
 * Avaliação pós-leitura já salva pelo usuário (slug → user_value), ou null
 * se ainda não preencheu. Usado pra pré-preencher o form na reabertura.
 */
export async function getExistingPostReadingAssessment(
  workId: string,
  userId: string,
  admin?: AdminClient,
): Promise<Record<CriterionSlug, number> | null> {
  const supabase = admin ?? createAdminClient()
  const { data, error } = await supabase
    .from("user_attribute_assessment")
    .select("attribute_slug, user_value")
    .eq("work_id", workId)
    .eq("user_id", userId)

  if (error) throw new Error(`Falha lendo user_attribute_assessment: ${error.message}`)
  if (!data || data.length === 0) return null

  const result = {} as Record<CriterionSlug, number>
  for (const row of data as Array<{ attribute_slug: string; user_value: number | string }>) {
    if (!SLUG_SET.has(row.attribute_slug)) continue
    result[row.attribute_slug as CriterionSlug] = Number(row.user_value)
  }
  return result
}
