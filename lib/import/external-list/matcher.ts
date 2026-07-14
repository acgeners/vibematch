// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

import { bestTitleMatchDetailed } from "@/lib/external"
import { getPersonalStatusNameById } from "@/lib/constants/status-lookups"
import type { AmbiguousCandidate, ExternalListEntry, FieldChange } from "./types"

const AUTO_MATCH_THRESHOLD = 0.85
const AMBIGUOUS_THRESHOLD = 0.65
const MAX_CANDIDATES = 3

export interface DbWork {
  id: string
  title: string
  original_title: string | null
  alternative_titles: string[]
  personal_status_id: number | null
  user_score: number | null
  chapters_read: number | null
}

export interface MatchContext {
  works: DbWork[]
  worksById: Map<string, DbWork>
  // `${source}:${externalId}` → workId
  externalIndex: Map<string, string>
}

export async function buildMatchContext(supabase: AnySupabaseClient): Promise<MatchContext> {
  // Lê o dado PESSOAL do DONO (personal_status_id, user_score, chapters_read) — é o lado
  // "atual" do diff da importação → vem do espelho via a view `works_owner`, não da linha
  // compartilhada de `works` (que vai perder essas colunas).
  const { data: works } = await supabase
    .from("works_owner")
    .select("id, title, original_title, alternative_titles, personal_status_id, user_score, chapters_read")

  const { data: extIds } = await supabase
    .from("work_external_ids")
    .select("work_id, source, external_id")

  const list: DbWork[] = (works ?? []).map((w: DbWork) => ({
    ...w,
    user_score: w.user_score == null ? null : Number(w.user_score),
    alternative_titles: w.alternative_titles ?? [],
  }))

  const worksById = new Map<string, DbWork>(list.map((w) => [w.id, w]))
  const externalIndex = new Map<string, string>()
  for (const row of extIds ?? []) {
    externalIndex.set(`${row.source}:${row.external_id}`, row.work_id)
  }

  return { works: list, worksById, externalIndex }
}

export type MatchOutcome =
  | { kind: "matched"; work: DbWork; matchedBy: "external_id" | "title"; score: number }
  | { kind: "ambiguous"; candidates: AmbiguousCandidate[] }
  | { kind: "new" }

export function matchEntry(entry: ExternalListEntry, ctx: MatchContext): MatchOutcome {
  // 1. ID externo confirmado.
  if (entry.externalId) {
    const workId = ctx.externalIndex.get(`${entry.source}:${entry.externalId}`)
    const work = workId ? ctx.worksById.get(workId) : undefined
    if (work) return { kind: "matched", work, matchedBy: "external_id", score: 1 }
  }

  // 2. Similaridade de título.
  const scored = ctx.works
    .map((work) => ({
      work,
      score: bestTitleMatchDetailed(entry.title, {
        title: work.title,
        originalTitle: work.original_title ?? undefined,
        alternativeTitles: work.alternative_titles,
      }).score,
    }))
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score < AMBIGUOUS_THRESHOLD) return { kind: "new" }
  if (top.score >= AUTO_MATCH_THRESHOLD) {
    return { kind: "matched", work: top.work, matchedBy: "title", score: top.score }
  }

  const candidates: AmbiguousCandidate[] = scored
    .filter((s) => s.score >= AMBIGUOUS_THRESHOLD)
    .slice(0, MAX_CANDIDATES)
    .map((s) => ({ workId: s.work.id, title: s.work.title, score: Math.round(s.score * 100) / 100 }))

  return { kind: "ambiguous", candidates }
}

// Compara a entrada com a obra casada e devolve só os campos que mudam.
export function buildChanges(entry: ExternalListEntry, work: DbWork): FieldChange[] {
  const changes: FieldChange[] = []

  if (entry.personalStatus != null) {
    const local = getPersonalStatusNameById(work.personal_status_id)
    if (local == null) {
      changes.push({ field: "personal_status", local: null, imported: entry.personalStatus, kind: "fill", defaultChoice: "imported" })
    } else if (local !== entry.personalStatus) {
      changes.push({ field: "personal_status", local, imported: entry.personalStatus, kind: "conflict", defaultChoice: "local" })
    }
  }

  if (entry.userScore != null) {
    if (work.user_score == null) {
      changes.push({ field: "user_score", local: null, imported: entry.userScore, kind: "fill", defaultChoice: "imported" })
    } else if (work.user_score !== entry.userScore) {
      changes.push({ field: "user_score", local: work.user_score, imported: entry.userScore, kind: "conflict", defaultChoice: "local" })
    }
  }

  if (entry.chaptersRead != null) {
    if (work.chapters_read == null) {
      changes.push({ field: "chapters_read", local: null, imported: entry.chaptersRead, kind: "fill", defaultChoice: "imported" })
    } else if (work.chapters_read !== entry.chaptersRead) {
      changes.push({
        field: "chapters_read",
        local: work.chapters_read,
        imported: entry.chaptersRead,
        kind: "conflict",
        // Capítulos costumam só avançar → sugere o maior.
        defaultChoice: entry.chaptersRead > work.chapters_read ? "imported" : "local",
      })
    }
  }

  return changes
}

// Rede de segurança por pg_trgm: o matcher em memória usa Jaccard de palavras,
// que erra quando o título importado diverge do salvo (ex.: "...is in Love" vs
// "...Loves" → 0.50). O RPC find_works_matching_titles usa trigram (mesmo do
// "Buscar dados") e pega esses casos (≥ 0.70). Usado só nas entradas que o
// matcher classificou como "novas", pra evitar criar duplicata.
const TRGM_THRESHOLD = 0.7

export async function findTrgmCandidates(
  supabase: AnySupabaseClient,
  title: string
): Promise<AmbiguousCandidate[]> {
  const { data, error } = await supabase.rpc("find_works_matching_titles", { query_titles: [title] })
  if (error || !data) return []
  return (data as Array<{ id: string; title: string; similarity: number | null }>)
    .filter((r) => (r.similarity ?? 0) >= TRGM_THRESHOLD)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, MAX_CANDIDATES)
    .map((r) => ({ workId: r.id, title: r.title, score: Math.round((r.similarity ?? 0) * 100) / 100 }))
}

export { AUTO_MATCH_THRESHOLD, AMBIGUOUS_THRESHOLD, TRGM_THRESHOLD }
