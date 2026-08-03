import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "@/server/queries/current-user"

// Uma importação registrada (tabela `imports`). Toda importação de lista grava
// uma linha aqui; a fonte fica em raw_metadata.source.
export interface ImportHistoryRow {
  id: string
  /** ExternalListSource ("anilist" | "myanimelist" | …) ou null (imports antigos). */
  source: string | null
  filename: string
  fileType: string
  status: string
  totalRows: number
  createdCount: number
  updatedCount: number
  skippedCount: number
  errorCount: number
  createdAt: string
  completedAt: string | null
}

interface ImportsRow {
  id: string
  filename: string
  file_type: string
  status: string
  total_rows: number
  imported_count: number
  updated_count: number
  skipped_count: number
  error_count: number
  created_at: string
  completed_at: string | null
  raw_metadata: { source?: string } | null
}

function toHistoryRow(r: ImportsRow): ImportHistoryRow {
  return {
    id: r.id,
    source: r.raw_metadata?.source ?? null,
    filename: r.filename,
    fileType: r.file_type,
    status: r.status,
    totalRows: r.total_rows,
    createdCount: r.imported_count,
    updatedCount: r.updated_count,
    skippedCount: r.skipped_count,
    errorCount: r.error_count,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }
}

// Histórico per-user (Bloco 02): cada um vê as PRÓPRIAS importações.
//
// 🔴 Resolvia por `getCurrentUserId()` — que sem sessão devolve o DONO. Medido em 2026-08-03:
// /import servia a visitante anônimo "Última importação anteontem · Lista de títulos +4 novas",
// o histórico dele inteiro. O filtro por user_id estava lá o tempo todo.
export async function getImportHistory(limit = 30): Promise<ImportHistoryRow[]> {
  const supabase = createAdminClient()
  const userId = await getSessionUserId()
  if (!userId) return []
  const { data, error } = await supabase
    .from("imports")
    .select(
      "id, filename, file_type, status, total_rows, imported_count, updated_count, skipped_count, error_count, created_at, completed_at, raw_metadata"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ImportsRow[]).map(toHistoryRow)
}

export interface ImportStats {
  catalogCount: number
  evaluatedCount: number
  lastImport: { source: string | null; createdAt: string; createdCount: number } | null
}

// Números do topo da página de import. Contagens via count exato (head) — não
// caem na armadilha do limite de 1000 linhas do select.
export async function getImportStats(): Promise<ImportStats> {
  const supabase = createAdminClient()
  // Sem sessão, `lastImport` fica null — o catálogo (contagens de obras) é compartilhado e
  // continua valendo pra todo mundo; a ÚLTIMA IMPORTAÇÃO é de alguém.
  const userId = await getSessionUserId()
  const [catalog, evaluated, last] = await Promise.all([
    supabase.from("works").select("*", { count: "exact", head: true }).eq("is_archived", false),
    supabase
      .from("works")
      .select("*", { count: "exact", head: true })
      .eq("is_archived", false)
      .eq("ai_eval_status", "done"),
    // Ramo explícito em vez de `.eq("user_id", userId)` com userId nulo: um null/undefined no
    // `.eq()` do PostgREST não dá erro — vira um filtro que não filtra, que é o mesmo bug
    // usando outra porta.
    userId
      ? supabase
          .from("imports")
          .select("imported_count, created_at, raw_metadata")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const lastRow = last.data as
    | { imported_count: number; created_at: string; raw_metadata: { source?: string } | null }
    | null

  return {
    catalogCount: catalog.count ?? 0,
    evaluatedCount: evaluated.count ?? 0,
    lastImport: lastRow
      ? {
          source: lastRow.raw_metadata?.source ?? null,
          createdAt: lastRow.created_at,
          createdCount: lastRow.imported_count,
        }
      : null,
  }
}
