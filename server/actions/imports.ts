"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { detectColumnMappings, applyMapping } from "@/lib/import/mapper"
import { validateRows } from "@/lib/import/validator"
import { processRows } from "@/lib/import/processor"
import type { ImportColumnMapping, RawImportRow } from "@/types/domain"
import type { DuplicateMode } from "@/lib/import/processor"

export interface StartImportArgs {
  filename: string
  fileType: "csv" | "xlsx"
  sheetName?: string
  rows: RawImportRow[]
  columns: string[]
  mappings?: ImportColumnMapping[]
  duplicateMode?: DuplicateMode
}

export async function startImport(args: StartImportArgs) {
  const supabase = createAdminClient()

  const effectiveMappings = args.mappings ?? detectColumnMappings(args.columns)

  // Criar registro de importação
  const { data: importRecord, error: importError } = await supabase
    .from("imports")
    .insert({
      filename: args.filename,
      file_type: args.fileType,
      sheet_name: args.sheetName ?? null,
      status: "processing",
      total_rows: args.rows.length,
      raw_metadata: {
        columns: args.columns,
        mappings: effectiveMappings,
      },
    })
    .select("id")
    .single()

  if (importError) return { error: importError.message }

  // Mapear e validar linhas
  const mapped = args.rows.map((row) => applyMapping(row, effectiveMappings))
  const { valid, errors } = validateRows(mapped)

  // Processar linhas válidas
  const result = await processRows(
    valid,
    {
      importId: importRecord.id,
      duplicateMode: args.duplicateMode ?? "update",
    },
    supabase
  )

  result.errors = [...result.errors, ...errors]
  result.errorCount += errors.length

  // Finalizar importação
  await supabase
    .from("imports")
    .update({
      status: "completed",
      imported_count: result.importedCount,
      updated_count: result.updatedCount,
      skipped_count: result.skippedCount,
      error_count: result.errorCount,
      completed_at: new Date().toISOString(),
    })
    .eq("id", importRecord.id)

  revalidatePath("/titles")
  revalidatePath("/")
  revalidatePath("/ranking")

  return {
    data: {
      importId: importRecord.id,
      ...result,
    },
  }
}
