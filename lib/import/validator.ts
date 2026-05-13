import { importRowSchema } from "@/lib/validations/import.schema"
import type { MappedImportRow, ImportValidationError } from "@/types/domain"

export interface ValidationResult {
  valid: MappedImportRow[]
  errors: ImportValidationError[]
}

/**
 * Valida uma lista de linhas mapeadas.
 * Linhas inválidas ficam no array de erros; linhas válidas passam.
 */
export function validateRows(rows: (MappedImportRow | null)[]): ValidationResult {
  const valid: MappedImportRow[] = []
  const errors: ImportValidationError[] = []

  rows.forEach((row, index) => {
    if (!row) {
      errors.push({ rowIndex: index, field: "title", message: "Linha sem título" })
      return
    }

    const result = importRowSchema.safeParse(row)
    if (result.success) {
      valid.push(result.data as MappedImportRow)
    } else {
      result.error.issues.forEach((issue) => {
        errors.push({
          rowIndex: index,
          field: issue.path.join(".") || "geral",
          message: issue.message,
        })
      })
    }
  })

  return { valid, errors }
}
