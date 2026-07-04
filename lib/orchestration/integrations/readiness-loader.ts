/**
 * Loader DB → WorkReadinessSnapshot (a INTEGRAÇÃO que o readiness.ts deixou pra
 * depois — ver seu doc-comment). Monta o snapshot de UMA obra a partir das
 * colunas reais, incluindo os sinais GLOBAIS (perfil de gosto, nº de obras
 * rotuladas). Alimenta o `buildPlan`.
 *
 * Staleness: por ora só `present` é preciso; `stale=false` (conservador — tratar
 * "presente" como "fresco" basta pro aviso "input ausente" da Fase 1). Refinar
 * com as assinaturas (*_version / *_hash / prediction.stale) quando o aviso
 * precisar distinguir "desatualizado" de "ausente".
 */
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { emptyReadinessSnapshot, type WorkReadinessSnapshot } from "../readiness"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0

interface WorkRow {
  canonical_synopsis?: string | null
  review_digest?: string | null
  review_summary?: string | null
  calculated_scores?: { expected_score?: number | null } | Array<{ expected_score?: number | null }> | null
}

export async function loadWorkReadinessSnapshot(
  workId: string,
  opts: { supabase?: SupabaseAdmin } = {},
): Promise<WorkReadinessSnapshot> {
  const snap = emptyReadinessSnapshot()
  if (!workId) return snap
  const sb = opts.supabase ?? createAdminClient()

  const [workRes, rawSynRes, tagRes, csRes, ratedRes, profile] = await Promise.all([
    sb
      .from("works")
      .select("id, canonical_synopsis, review_digest, review_summary, calculated_scores(expected_score)")
      .eq("id", workId)
      .maybeSingle(),
    sb.from("work_synopses").select("id", { count: "exact", head: true }).eq("work_id", workId),
    sb.from("work_tags").select("id", { count: "exact", head: true }).eq("work_id", workId),
    sb.from("category_scores").select("id", { count: "exact", head: true }).eq("work_id", workId),
    sb.from("works").select("id", { count: "exact", head: true }).eq("is_archived", false).not("user_score", "is", null),
    loadCurrentTasteProfile(),
  ])

  const work = (workRes.data as WorkRow | null) ?? null
  const cs = Array.isArray(work?.calculated_scores) ? work?.calculated_scores[0] : work?.calculated_scores

  snap.hasWorkRow = !!work
  snap.canonical = { present: nonEmpty(work?.canonical_synopsis), stale: false }
  snap.rawSynopsisCount = rawSynRes.count ?? 0
  snap.tagsCount = tagRes.count ?? 0
  // Presença dos atributos (source-independente) — mesma leitura do gate da Nota
  // Prevista. 9 = completo (resolveReadiness usa isso p/ category_scores_ai).
  snap.categoryScoresAiCount = csRes.count ?? 0
  snap.ratedWorksCount = ratedRes.count ?? 0
  snap.summary = { present: nonEmpty(work?.review_summary), stale: false }
  snap.digest = { present: nonEmpty(work?.review_digest), stale: false }
  snap.scores = { present: cs?.expected_score != null, stale: false }
  snap.tasteProfile = { present: !!profile, isStub: profile?.is_stub ?? false, stale: false }

  return snap
}
