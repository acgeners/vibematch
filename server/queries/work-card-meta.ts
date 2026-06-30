import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
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

/**
 * Conta tags (work_tags) e reviews ÚTEIS por obra, escopado aos `ids` exibidos
 * (chunked `.in`, sem full scan). Mesma regra de utilidade da aba "Sem reviews".
 * Usado pelos badges dos cards de IA atributos / Veredito IA — hidratado só na
 * aba ativa, não no caminho do cache de contagens.
 */
export async function getWorkTagReviewCounts(ids: string[]): Promise<Map<string, WorkCardCounts>> {
  const out = new Map<string, WorkCardCounts>()
  if (ids.length === 0) return out
  for (const id of ids) out.set(id, { tagCount: 0, reviewCount: 0 })
  const sb = createAdminClient()

  await Promise.all([
    (async () => {
      for (const c of chunk(ids, CHUNK)) {
        const { data, error } = await sb.from("work_tags").select("work_id").in("work_id", c)
        if (error) throw new Error(`work_tags: ${error.message}`)
        for (const r of (data ?? []) as Array<{ work_id: string }>) {
          const e = out.get(r.work_id)
          if (e) e.tagCount += 1
        }
      }
    })(),
    (async () => {
      for (const c of chunk(ids, CHUNK)) {
        const { data, error } = await sb.from("work_reviews").select("work_id, text_length").in("work_id", c)
        if (error) throw new Error(`work_reviews: ${error.message}`)
        for (const r of (data ?? []) as Array<{ work_id: string; text_length: number | null }>) {
          if (isUsefulReviewLength(r.text_length)) {
            const e = out.get(r.work_id)
            if (e) e.reviewCount += 1
          }
        }
      }
    })(),
    (async () => {
      for (const c of chunk(ids, CHUNK)) {
        const { data, error } = await sb.from("work_external_reviews_manual").select("work_id, text").in("work_id", c)
        if (error) throw new Error(`work_external_reviews_manual: ${error.message}`)
        for (const r of (data ?? []) as Array<{ work_id: string; text: string | null }>) {
          if (isUsefulReviewText(r.text)) {
            const e = out.get(r.work_id)
            if (e) e.reviewCount += 1
          }
        }
      }
    })(),
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
