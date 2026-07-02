import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRowsParallel } from "@/lib/supabase/paginate"
import { isUsefulReviewLength, isUsefulReviewText } from "@/lib/reviews/useful-review"
import { fetchReviewDigestsBatch } from "@/server/queries/recommendations"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

const CHUNK = 200

export interface WorkCardCounts {
  tagCount: number
  /** Reviews ÚTEIS (≥40 chars): work_reviews buscadas + work_external_reviews_manual. */
  reviewCount: number
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Contagens por obra via RPC agregada `work_card_counts` (migration 122): 1 linha por
 * obra (GROUP BY em SQL) em vez de varrer work_tags (~30k) / work_reviews (~10k) e
 * contar em JS. `ids=null` = TODAS as obras. Retorna `null` se a função não existir
 * (erro) → o chamador cai no fallback TS (scan). Regra de review útil = ≥40 chars
 * (bate com lib/reviews/useful-review). Compartilhado por getWorksWithout{Reviews,Tags}.
 */
export async function workCardCountsRpc(
  sb: AdminClient,
  ids: string[] | null,
): Promise<Map<string, WorkCardCounts> | null> {
  if (ids && ids.length === 0) return new Map()
  const { data, error } = await sb.rpc("work_card_counts", { work_ids: ids })
  if (error) return null
  const out = new Map<string, WorkCardCounts>()
  for (const r of (data ?? []) as Array<{ work_id: string; tag_count: number | null; review_count: number | null }>) {
    out.set(r.work_id, { tagCount: Number(r.tag_count) || 0, reviewCount: Number(r.review_count) || 0 })
  }
  return out
}

/**
 * Conta tags (work_tags) e reviews ÚTEIS por obra, escopado aos `ids` exibidos.
 * Mesma regra de utilidade da aba "Sem reviews". Usado pelos badges/filtros dos
 * cards. Chunk de ids + PAGINAÇÃO por chunk: sem o `.range`, um chunk grande (ex.:
 * ~200 obras × ~15 tags) estoura o teto default de 1000 linhas do PostgREST e
 * SUBCONTA — o que quebrava o filtro "≥N tags" na fila grande do Interesse.
 */
export async function getWorkTagReviewCounts(ids: string[]): Promise<Map<string, WorkCardCounts>> {
  if (ids.length === 0) return new Map()
  const sb = createAdminClient()

  // Caminho rápido: RPC agregada (migration 122) — 1 chamada, contagens em SQL.
  const rpc = await workCardCountsRpc(sb, ids)
  if (rpc) {
    for (const id of ids) if (!rpc.has(id)) rpc.set(id, { tagCount: 0, reviewCount: 0 })
    return rpc
  }

  // Fallback (RPC ausente): conta varrendo as tabelas em JS. Paginação PARALELA por
  // chunk (HEAD count → páginas concorrentes); as 3 tabelas em paralelo entre si.
  const out = new Map<string, WorkCardCounts>()
  for (const id of ids) out.set(id, { tagCount: 0, reviewCount: 0 })
  await Promise.all([
    Promise.all(chunk(ids, CHUNK).map(async (c) => {
      const rows = await fetchAllRowsParallel<{ work_id: string }>(
        () => sb.from("work_tags").select("work_id", { count: "exact", head: true }).in("work_id", c),
        (from, to) => sb.from("work_tags").select("work_id").in("work_id", c).range(from, to),
        "work_tags",
      )
      for (const r of rows) {
        const e = out.get(r.work_id)
        if (e) e.tagCount += 1
      }
    })),
    Promise.all(chunk(ids, CHUNK).map(async (c) => {
      const rows = await fetchAllRowsParallel<{ work_id: string; text_length: number | null }>(
        () => sb.from("work_reviews").select("work_id", { count: "exact", head: true }).in("work_id", c),
        (from, to) => sb.from("work_reviews").select("work_id, text_length").in("work_id", c).range(from, to),
        "work_reviews",
      )
      for (const r of rows) {
        if (isUsefulReviewLength(r.text_length)) {
          const e = out.get(r.work_id)
          if (e) e.reviewCount += 1
        }
      }
    })),
    Promise.all(chunk(ids, CHUNK).map(async (c) => {
      const rows = await fetchAllRowsParallel<{ work_id: string; text: string | null }>(
        () => sb.from("work_external_reviews_manual").select("work_id", { count: "exact", head: true }).in("work_id", c),
        (from, to) => sb.from("work_external_reviews_manual").select("work_id, text").in("work_id", c).range(from, to),
        "work_external_reviews_manual",
      )
      for (const r of rows) {
        if (isUsefulReviewText(r.text)) {
          const e = out.get(r.work_id)
          if (e) e.reviewCount += 1
        }
      }
    })),
  ])
  return out
}

export interface SynopsisInputs {
  canonicalSynopsis: string | null
  tags: string[]
  reviewDigest: ReviewDigest | null
}

/**
 * Hidrata os INPUTS que o preditor de Interesse na sinopse usa: sinopse canônica
 * (`works.canonical_synopsis`), tags da obra e digest de reviews (`works.review_digest`).
 * Escopado aos `ids` exibidos. Usado pelo popover "inputs da previsão" da aba
 * Interesse na Obra — fora do caminho do cache de contagens.
 */
export async function getSynopsisInputsBatch(ids: string[]): Promise<Map<string, SynopsisInputs>> {
  const out = new Map<string, SynopsisInputs>()
  if (ids.length === 0) return out
  const sb = createAdminClient()

  for (const c of chunk(ids, CHUNK)) {
    const { data, error } = await sb
      .from("works")
      .select("id, canonical_synopsis, work_tags(tags(name))")
      .in("id", c)
    if (error) throw new Error(`works synopsis/tags: ${error.message}`)
    for (const row of (data ?? []) as Array<{
      id: string
      canonical_synopsis: string | null
      work_tags?: Array<{ tags: { name: string } | Array<{ name: string }> | null }> | null
    }>) {
      const tags: string[] = []
      for (const t of row.work_tags ?? []) {
        const tag = Array.isArray(t.tags) ? t.tags[0] : t.tags
        if (tag?.name) tags.push(tag.name)
      }
      out.set(row.id, { canonicalSynopsis: row.canonical_synopsis ?? null, tags, reviewDigest: null })
    }
  }

  const digests = await fetchReviewDigestsBatch(ids)
  for (const [id, d] of digests) {
    const e = out.get(id)
    if (e) e.reviewDigest = d
  }
  return out
}
