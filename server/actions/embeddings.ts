"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import type { CategoryScoreMap, CriterionSlug } from "@/types/domain"
import {
  buildEmbeddingInput,
  type EmbeddingInputData,
} from "@/lib/ml/embedding-input"
import {
  embedTexts,
  EMBEDDING_MODEL,
  MAX_BATCH_SIZE,
} from "@/lib/ml/embeddings"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { buildReviewContext } from "@/lib/tags/infer-from-text"

const QUERY_LIMIT = 2000

export interface RefreshEmbeddingsResult {
  totalWorks: number
  /** Quantas obras já tinham embedding atualizado (hash bate). */
  skipped: number
  /** Quantas obras embedaram nesta execução. */
  refreshed: number
  /** Tokens consumidos no total — multiplique por $0.02/M pra estimar custo. */
  tokensUsed: number
  /** Estimativa de custo em USD (text-embedding-3-small: $0.02/M tokens). */
  estimatedCostUsd: number
  /** Quantas obras falharam (erro persistido em logs). */
  failed: number
}

interface WorkForEmbedding {
  workId: string
  data: EmbeddingInputData
}

interface ExistingHashRow {
  work_id: string
  input_hash: string
  model_name: string
}

function buildWorkFromRow(row: Record<string, unknown>): WorkForEmbedding {
  const categoryScores: CategoryScoreMap = {}
  for (const cs of (row.category_scores as Array<{ criterion_slug: string; score: number }> | null) ??
    []) {
    categoryScores[cs.criterion_slug as CriterionSlug] = Number(cs.score)
  }

  const tags = ((row.work_tags as
    | Array<{ tags?: { name?: string; tag_group_id?: string | null } | null }>
    | null) ?? [])
    .map((wt) => wt?.tags)
    .filter(
      (t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name),
    )
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null : null,
    }))

  const synopsis = pickPrimarySynopsis(
    (row.work_synopses as
      | Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }>
      | undefined)?.map((s) => ({
      text: s.text ?? null,
      is_primary: s.is_primary ?? null,
      position: s.position ?? null,
    })),
  )

  const reviewContext =
    buildReviewContext(row.review_summary, row.review_digest) ?? null

  return {
    workId: row.id as string,
    data: {
      title: row.title as string,
      synopsis,
      tags,
      categoryScores,
      reviewContext,
    },
  }
}

type Candidate = WorkForEmbedding & { hash: string; text: string }

async function loadEmbeddingCandidates(): Promise<{
  totalWorks: number
  skipped: number
  candidates: Candidate[]
}> {
  const supabase = createAdminClient()

  const [worksRes, existingRes] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, title, review_digest, review_summary,
         category_scores(criterion_slug, score),
         work_tags(tags(name, tag_group_id)),
         work_synopses(text, is_primary, position)`,
      )
      .eq("is_archived", false)
      .limit(QUERY_LIMIT),
    supabase
      .from("work_embeddings")
      .select("work_id, input_hash, model_name"),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (existingRes.error) throw new Error(existingRes.error.message)

  const existingByWork = new Map<string, ExistingHashRow>(
    (existingRes.data as ExistingHashRow[] | null ?? []).map((r) => [r.work_id, r]),
  )

  const works = (worksRes.data as Array<Record<string, unknown>>).map(buildWorkFromRow)
  const totalWorks = works.length

  const candidates: Candidate[] = []
  let skipped = 0

  for (const w of works) {
    const { text, hash } = buildEmbeddingInput(w.data)
    const existing = existingByWork.get(w.workId)
    const upToDate = existing?.input_hash === hash && existing?.model_name === EMBEDDING_MODEL
    if (upToDate) {
      skipped += 1
      continue
    }
    candidates.push({ ...w, hash, text })
  }

  return { totalWorks, skipped, candidates }
}

export interface EmbeddingsPendingCount {
  totalWorks: number
  pending: number
}

/**
 * Conta obras com embedding desatualizado (sem chamar a OpenAI). Usa o mesmo
 * critério do refresh: hash atual difere do persistido, modelo mudou, ou não
 * há linha em work_embeddings.
 */
export async function countStaleEmbeddings(): Promise<EmbeddingsPendingCount> {
  const { totalWorks, candidates } = await loadEmbeddingCandidates()
  return { totalWorks, pending: candidates.length }
}

/**
 * Identifica obras com embedding desatualizado e re-embeda apenas elas.
 *
 * Critério "desatualizado": `input_hash` da obra atual difere do que está
 * persistido em `work_embeddings`, OU não existe registro pra essa obra,
 * OU `model_name` mudou.
 */
export async function refreshEmbeddings(): Promise<RefreshEmbeddingsResult> {
  const supabase = createAdminClient()
  const { totalWorks, skipped, candidates } = await loadEmbeddingCandidates()

  if (candidates.length === 0) {
    return {
      totalWorks,
      skipped,
      refreshed: 0,
      tokensUsed: 0,
      estimatedCostUsd: 0,
      failed: 0,
    }
  }

  let refreshed = 0
  let failed = 0
  let totalTokens = 0

  // Processa em chunks alinhados com o batch da API pra erros mais granulares
  for (let i = 0; i < candidates.length; i += MAX_BATCH_SIZE) {
    const chunk = candidates.slice(i, i + MAX_BATCH_SIZE)
    try {
      const { vectors, tokensUsed } = await embedTexts(chunk.map((c) => c.text))
      totalTokens += tokensUsed

      const rows = chunk.map((c, idx) => ({
        work_id: c.workId,
        embedding: JSON.stringify(vectors[idx]),
        model_name: EMBEDDING_MODEL,
        input_hash: c.hash,
        updated_at: new Date().toISOString(),
      }))

      const { error: upsertErr } = await supabase
        .from("work_embeddings")
        .upsert(rows, { onConflict: "work_id" })

      if (upsertErr) {
        console.error(`[embeddings] upsert falhou no chunk ${i}: ${upsertErr.message}`)
        failed += chunk.length
      } else {
        refreshed += chunk.length
      }
    } catch (err) {
      console.error(
        `[embeddings] chunk ${i} (${chunk.length} obras) falhou:`,
        err instanceof Error ? err.message : err,
      )
      failed += chunk.length
    }
  }

  return {
    totalWorks,
    skipped,
    refreshed,
    tokensUsed: totalTokens,
    estimatedCostUsd: (totalTokens / 1_000_000) * 0.02,
    failed,
  }
}
