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

// Pagina de 1000 em 1000: o select do PostgREST corta em 1000 SEM AVISO, e duas das três
// leituras daqui já passavam (ou passariam em breve) do teto — work_external_ids tinha
// 6.933 linhas com o índice truncado em 1000, e o catálogo (966) está a meses de estourar.
// Um índice truncado não dá erro: o match por ID falha em silêncio e cai pro título.
async function fetchAll(
  supabase: AnySupabaseClient,
  table: string,
  select: string,
  filter?: (q: AnySupabaseClient) => AnySupabaseClient,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`buildMatchContext(${table}): ${error.message}`)
    const batch = (data ?? []) as Record<string, unknown>[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }
  return rows
}

/**
 * Lado "atual" do diff da importação, PARA UM USUÁRIO: o catálogo compartilhado (títulos,
 * pra o match) + o estado pessoal DELE (`user_work_state`: status, nota, capítulos — pra
 * decidir fill × conflito). Antes lia `works_owner` (o espelho do DONO): um segundo usuário
 * reconciliaria a lista dele contra o SEU estado — conflito fantasma em tudo que você já leu.
 */
export async function buildMatchContext(
  supabase: AnySupabaseClient,
  userId: string,
): Promise<MatchContext> {
  // SEM filtro de is_archived, de propósito (igual ao comportamento anterior): obra
  // arquivada continua no índice de match — senão importar uma lista que a contém
  // criaria uma DUPLICATA dela no catálogo.
  const [works, states, extIds] = await Promise.all([
    fetchAll(supabase, "works", "id, title, original_title, alternative_titles"),
    fetchAll(supabase, "user_work_state", "work_id, personal_status_id, user_score, chapters_read", (q) =>
      q.eq("user_id", userId),
    ),
    fetchAll(supabase, "work_external_ids", "work_id, source, external_id"),
  ])

  const stateByWork = new Map(states.map((s) => [s.work_id as string, s]))

  const list: DbWork[] = works.map((w) => {
    const s = stateByWork.get(w.id as string)
    return {
      id: w.id as string,
      title: w.title as string,
      original_title: (w.original_title as string | null) ?? null,
      alternative_titles: (w.alternative_titles as string[] | null) ?? [],
      personal_status_id: (s?.personal_status_id as number | null | undefined) ?? null,
      user_score: s?.user_score == null ? null : Number(s.user_score),
      chapters_read: (s?.chapters_read as number | null | undefined) ?? null,
    }
  })

  const worksById = new Map<string, DbWork>(list.map((w) => [w.id, w]))
  const externalIndex = new Map<string, string>()
  for (const row of extIds) {
    externalIndex.set(`${row.source}:${row.external_id}`, row.work_id as string)
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
