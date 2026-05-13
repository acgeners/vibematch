// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

import type { MappedImportRow, ImportResult } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"

export type DuplicateMode = "skip" | "update" | "create_new"

export interface ProcessOptions {
  importId: string
  duplicateMode: DuplicateMode
}

/**
 * Processa as linhas validadas e grava no Supabase.
 * Retorna um relatório com contadores e erros encontrados.
 */
export async function processRows(
  rows: MappedImportRow[],
  options: ProcessOptions,
  supabase: AnySupabaseClient
): Promise<ImportResult> {
  const result: ImportResult = {
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    errors: [],
    pendingAiCount: 0,
  }

  const BATCH_SIZE = 50

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      try {
        await processSingleRow(row, options, supabase, result)
      } catch (err) {
        result.errorCount++
        result.errors.push({
          rowIndex: i,
          field: "geral",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return result
}

async function processSingleRow(
  row: MappedImportRow,
  options: ProcessOptions,
  supabase: AnySupabaseClient,
  result: ImportResult
) {
  const titleLower = row.title.toLowerCase().trim()

  // Verificar duplicata
  const { data: existing } = await supabase
    .from("works")
    .select("id, ai_eval_status")
    .ilike("title", titleLower)
    .maybeSingle()

  let workId: string

  if (existing) {
    result.duplicateCount++

    if (options.duplicateMode === "skip") {
      result.skippedCount++
      await recordImportRow(supabase, options.importId, row, "skipped", existing.id)
      return
    }

    if (options.duplicateMode === "update") {
      await updateWork(supabase, existing.id, row)
      workId = existing.id
      result.updatedCount++
    } else {
      // create_new: mesmo título, cria mesmo assim
      workId = await createWork(supabase, row)
      result.importedCount++
    }
  } else {
    workId = await createWork(supabase, row)
    result.importedCount++
  }

  // Notas por critério
  const hasScores = CRITERION_SLUGS.some(
    (slug) => row[slug as keyof MappedImportRow] != null
  )

  if (hasScores) {
    await upsertCategoryScores(supabase, workId, row)
  }

  // Plataformas
  await upsertPlatformRatings(supabase, workId, row)

  // Scores calculados da planilha (se presentes)
  if (row.predicted_score != null || row.calc_score != null || row.final_score != null) {
    await upsertCalculatedScores(supabase, workId, row)
  }

  // Status de IA
  if (!hasScores) {
    result.pendingAiCount++
  }

  // Registro da linha importada
  await recordImportRow(supabase, options.importId, row, "imported", workId)

  // Atualizar status de IA no work
  const aiStatus = hasScores ? "done" : "pending"
  await supabase
    .from("works")
    .update({ ai_eval_status: aiStatus })
    .eq("id", workId)
}

async function createWork(
  supabase: AnySupabaseClient,
  row: MappedImportRow
): Promise<string> {
  const { data, error } = await supabase
    .from("works")
    .insert({
      title: row.title,
      publication_status: row.publication_status ?? "Unknown",
      personal_status: row.personal_status ?? "To read",
      total_chapters: row.total_chapters ?? null,
      chapters_read: row.chapters_read ?? null,
      synopsis_quality: row.synopsis_quality ?? null,
      observation_penalty: row.observation_penalty ?? 0,
      manual_score: row.manual_score ?? null,
      ai_eval_status: "pending",
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  return data.id
}

async function updateWork(
  supabase: AnySupabaseClient,
  workId: string,
  row: MappedImportRow
) {
  const update: Record<string, unknown> = {}
  if (row.publication_status) update.publication_status = row.publication_status
  if (row.personal_status) update.personal_status = row.personal_status
  if (row.total_chapters != null) update.total_chapters = row.total_chapters
  if (row.chapters_read != null) update.chapters_read = row.chapters_read
  if (row.synopsis_quality) update.synopsis_quality = row.synopsis_quality
  if (row.observation_penalty != null) update.observation_penalty = row.observation_penalty
  if (row.manual_score != null) update.manual_score = row.manual_score

  if (Object.keys(update).length > 0) {
    await supabase.from("works").update(update).eq("id", workId)
  }
}

async function upsertCategoryScores(
  supabase: AnySupabaseClient,
  workId: string,
  row: MappedImportRow
) {
  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = row[slug as keyof MappedImportRow]
    if (score == null) return []
    return [{ work_id: workId, criterion_slug: slug, score: Number(score), source: "imported" }]
  })

  if (scores.length > 0) {
    await supabase
      .from("category_scores")
      .upsert(scores, { onConflict: "work_id,criterion_slug" })
  }
}

async function upsertPlatformRatings(
  supabase: AnySupabaseClient,
  workId: string,
  row: MappedImportRow
) {
  const platformData = [
    { platform: "mangaupdates", rating: row.mu_rating, votes: row.mu_votes },
    { platform: "animeplanet", rating: row.ap_rating, votes: row.ap_votes },
    { platform: "comick", rating: row.cmx_rating, votes: row.cmx_votes },
  ]

  const toUpsert = platformData
    .filter((p) => p.rating != null || (p.votes != null && p.votes > 0))
    .map((p) => ({
      work_id: workId,
      platform: p.platform,
      rating: p.rating ?? null,
      vote_count: p.votes ?? 0,
    }))

  if (toUpsert.length > 0) {
    await supabase
      .from("platform_ratings")
      .upsert(toUpsert, { onConflict: "work_id,platform" })
  }
}

async function upsertCalculatedScores(
  supabase: AnySupabaseClient,
  workId: string,
  row: MappedImportRow
) {
  const totalVotes = (row.mu_votes ?? 0) + (row.ap_votes ?? 0) + (row.cmx_votes ?? 0)

  await supabase
    .from("calculated_scores")
    .upsert(
      {
        work_id: workId,
        total_votes: totalVotes,
        ia_eval: row.ia_eval ?? null,
        ia_eval_normalized: row.ia_eval_normalized ?? null,
        calc_score: row.calc_score ?? null,
        predicted_score: row.predicted_score ?? null,
        predicted_is_stub: row.predicted_score == null,
        final_score: row.final_score ?? null,
        formula_version: "v1_imported",
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "work_id" }
    )
}

async function recordImportRow(
  supabase: AnySupabaseClient,
  importId: string,
  row: MappedImportRow,
  status: string,
  workId: string | null
) {
  await supabase.from("import_rows").insert({
    import_id: importId,
    row_index: 0,
    raw_data: row as unknown as Record<string, unknown>,
    status,
    work_id: workId,
  })
}
