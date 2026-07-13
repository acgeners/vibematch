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

// Presente = não-nulo e, se string, não-vazia. Robusto a colunas JSONB
// (review_digest/review_summary são jsonb → vêm como objeto/string, não texto puro).
const nonEmpty = (v: unknown): boolean =>
  v != null && (typeof v !== "string" || v.trim().length > 0)

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
    sb.from("works_owner").select("id", { count: "exact", head: true }).eq("is_archived", false).not("user_score", "is", null),
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

/**
 * Versão EM LOTE — snapshots de várias obras pra as filas (por-obra seria N×
 * round-trips). Queries só-`id`/só-`work_id` (sem trafegar texto de sinopse/
 * digest): presença via filtro `.not(col,is,null).neq(col,'')` devolvendo apenas
 * ids; contagens agregadas em JS. Sinais globais (perfil, nº-rotuladas) uma vez.
 * Segue o padrão de scan chunkado de `getWorksWithoutTags`.
 */
export async function loadWorkReadinessSnapshots(
  workIds: string[],
  opts: { supabase?: SupabaseAdmin } = {},
): Promise<Map<string, WorkReadinessSnapshot>> {
  const out = new Map<string, WorkReadinessSnapshot>()
  for (const id of workIds) out.set(id, emptyReadinessSnapshot())
  if (workIds.length === 0) return out
  const sb = opts.supabase ?? createAdminClient()

  const chunk = <T,>(a: T[], n: number): T[][] => {
    const o: T[][] = []
    for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
    return o
  }
  const idChunks = chunk(workIds, 200)

  const hasCanonical = new Set<string>()
  const hasDigest = new Set<string>()
  const hasSummary = new Set<string>()
  const rawCount = new Map<string, number>()
  const tagCount = new Map<string, number>()
  const csCount = new Map<string, number>()

  // Presença de uma coluna de `works` — devolve só os ids com valor não-nulo.
  // `.not(col,is,null)` vale pra text E jsonb (review_digest/summary são jsonb);
  // NÃO uso `.neq(col,'')` porque em jsonb '' não é JSON válido → erro no PG.
  const presence = (col: string, into: Set<string>) =>
    Promise.all(
      idChunks.map(async (c) => {
        const { data, error } = await sb.from("works").select("id").in("id", c).not(col, "is", null)
        if (error) throw new Error(`readiness ${col}: ${error.message}`)
        for (const r of (data ?? []) as Array<{ id: string }>) into.add(r.id)
      }),
    )
  // Contagem por obra de uma tabela filha (só `work_id`).
  const countBy = (table: "work_synopses" | "work_tags" | "category_scores", into: Map<string, number>) =>
    Promise.all(
      idChunks.map(async (c) => {
        const { data, error } = await sb.from(table).select("work_id").in("work_id", c)
        if (error) throw new Error(`readiness ${table}: ${error.message}`)
        for (const r of (data ?? []) as Array<{ work_id: string }>) into.set(r.work_id, (into.get(r.work_id) ?? 0) + 1)
      }),
    )

  const [profile, ratedRes] = await Promise.all([
    loadCurrentTasteProfile(),
    sb.from("works_owner").select("id", { count: "exact", head: true }).eq("is_archived", false).not("user_score", "is", null),
    presence("canonical_synopsis", hasCanonical),
    presence("review_digest", hasDigest),
    presence("review_summary", hasSummary),
    countBy("work_synopses", rawCount),
    countBy("work_tags", tagCount),
    countBy("category_scores", csCount),
  ])
  const ratedWorksCount = ratedRes.count ?? 0

  for (const id of workIds) {
    const snap = out.get(id)!
    snap.hasWorkRow = true
    snap.canonical = { present: hasCanonical.has(id), stale: false }
    snap.rawSynopsisCount = rawCount.get(id) ?? 0
    snap.tagsCount = tagCount.get(id) ?? 0
    snap.categoryScoresAiCount = csCount.get(id) ?? 0
    snap.summary = { present: hasSummary.has(id), stale: false }
    snap.digest = { present: hasDigest.has(id), stale: false }
    snap.tasteProfile = { present: !!profile, isStub: profile?.is_stub ?? false, stale: false }
    snap.ratedWorksCount = ratedWorksCount
  }
  return out
}
